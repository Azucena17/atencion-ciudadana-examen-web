const reportForm = document.querySelector("#report-form");
const formMessage = document.querySelector("#form-message");
const photoInput = document.querySelector("#photo");
const uploadTitle = document.querySelector("#upload-title");
const uploadHelp = document.querySelector("#upload-help");
const submitButton = document.querySelector("#submit-button");
const adminMessage = document.querySelector("#admin-message");
const reportList = document.querySelector("#report-list");
const emptyState = document.querySelector("#empty-state");
const adminKeyStorage = "municipal-admin-key";

document.querySelector("#current-year").textContent = new Date().getFullYear();

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => {
    const showAdmin = button.dataset.view === "admin";
    document.querySelectorAll(".nav-link").forEach((nav) => nav.classList.toggle("is-active", nav === button));
    document.querySelector("#citizen-view").classList.toggle("is-visible", !showAdmin);
    document.querySelector("#admin-view").classList.toggle("is-visible", showAdmin);
    document.querySelector("#admin-view").hidden = !showAdmin;
    if (showAdmin) loadReports();
  });
});

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  uploadTitle.textContent = file ? file.name : "Haz clic para adjuntar una imagen";
  uploadHelp.textContent = file
    ? `${(file.size / (1024 * 1024)).toFixed(2)} MB · Se optimiza al enviar`
    : "JPG, PNG o WebP · Máximo 5 MB";
});

reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(formMessage, "", "");
  if (!reportForm.reportValidity()) return;

  submitButton.disabled = true;
  submitButton.innerHTML = "Enviando... <span aria-hidden=\"true\">↗</span>";
  try {
    const originalPhoto = photoInput.files[0];
    if (originalPhoto.size > 5 * 1024 * 1024) throw new Error("La fotografía no puede superar los 5 MB.");
    const { photo, thumbnail } = await preparePhoto(originalPhoto);
    const formData = new FormData(reportForm);
    formData.set("photo", photo, "reporte.jpg");
    formData.set("thumbnail", thumbnail, "vista-previa.jpg");
    const response = await fetch("/api/reports", { method: "POST", body: formData });
    const result = await readResponse(response);
    setMessage(formMessage, `${result.message} Folio: ${result.id}`, "success");
    reportForm.reset();
    uploadTitle.textContent = "Haz clic para adjuntar una imagen";
    uploadHelp.textContent = "JPG, PNG o WebP · Máximo 5 MB";
  } catch (error) {
    setMessage(formMessage, error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = "Enviar reporte <span aria-hidden=\"true\">→</span>";
  }
});

document.querySelector("#refresh-button").addEventListener("click", loadReports);
document.querySelector("#status-filter").addEventListener("change", renderFilteredReports);
document.querySelector("#search-input").addEventListener("input", renderFilteredReports);

let reports = [];

async function readResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
  return result;
}

function setMessage(element, message, type) {
  element.textContent = message;
  element.classList.toggle("is-error", type === "error");
  element.classList.toggle("is-success", type === "success");
}

async function preparePhoto(file) {
  let image;
  try {
    image = await createImageBitmap(file);
    const photo = await compressImage(image, 1280, 600 * 1024);
    const thumbnail = await compressImage(image, 240, 24 * 1024);
    return { photo, thumbnail };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("No se pudo optimizar")) throw error;
    throw new Error("No se pudo leer la imagen. Elige un archivo JPG, PNG o WebP válido.");
  } finally {
    image?.close();
  }
}

async function compressImage(image, maxWidth, maxBytes) {
  let width = Math.min(image.width, maxWidth);
  let height = Math.round(image.height * (width / image.width));
  const qualities = [0.84, 0.76, 0.68, 0.6, 0.52, 0.45];

  for (let resizeAttempt = 0; resizeAttempt < 8; resizeAttempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo optimizar la fotografía en este navegador.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= maxBytes) return blob;
    }

    width = Math.max(1, Math.floor(width * 0.75));
    height = Math.max(1, Math.round(image.height * (width / image.width)));
  }

  throw new Error("No se pudo optimizar la fotografía. Elige una imagen diferente.");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function getAdminKey() {
  let key = sessionStorage.getItem(adminKeyStorage);
  if (!key) {
    key = window.prompt("Ingresa la clave de administración configurada por el responsable del sistema:");
    if (key) sessionStorage.setItem(adminKeyStorage, key);
  }
  return key;
}

async function adminFetch(url, options = {}) {
  const key = getAdminKey();
  if (!key) throw new Error("Se necesita la clave de administración para consultar los reportes.");
  const response = await fetch(url, {
    ...options,
    headers: { "x-admin-key": key, ...(options.headers || {}) },
  });
  if (response.status === 401) sessionStorage.removeItem(adminKeyStorage);
  return readResponse(response);
}

async function loadReports() {
  setMessage(adminMessage, "Cargando reportes...", "");
  reportList.replaceChildren();
  emptyState.hidden = true;
  try {
    const result = await adminFetch("/api/reports");
    reports = result.reports;
    setMessage(adminMessage, `${reports.length} reporte${reports.length === 1 ? "" : "s"} registrado${reports.length === 1 ? "" : "s"}.`, "");
    renderFilteredReports();
  } catch (error) {
    setMessage(adminMessage, error.message, "error");
  }
}

function renderFilteredReports() {
  const status = document.querySelector("#status-filter").value;
  const search = document.querySelector("#search-input").value.trim().toLocaleLowerCase("es");
  const visibleReports = reports.filter((report) => {
    const matchesStatus = !status || report.status === status;
    const searchable = `${report.location} ${report.description} ${report.category} ${report.name}`.toLocaleLowerCase("es");
    return matchesStatus && searchable.includes(search);
  });

  reportList.innerHTML = visibleReports.map((report) => `
    <article class="report-card">
      ${report.photoUrl
        ? `<img class="report-photo" src="${escapeHtml(report.photoUrl)}" alt="Fotografía del reporte de ${escapeHtml(report.category)}" loading="lazy" />`
        : '<div class="report-photo" aria-label="Sin fotografía"></div>'}
      <div class="report-details">
        <div class="report-meta"><span class="category-tag">${escapeHtml(report.category)}</span></div>
        <h2>${escapeHtml(report.name)}</h2>
        <p class="report-location">⌖ ${escapeHtml(report.location)}</p>
        <p>${escapeHtml(report.description)}</p>
        <span class="report-date">Folio ${escapeHtml(report.id)} · ${formatDate(report.createdAt)}</span>
      </div>
      <label class="status-control">Estado
        <select data-report-id="${escapeHtml(report.id)}" aria-label="Estado del reporte ${escapeHtml(report.id)}">
          ${["Recibida", "En proceso", "Resuelta"].map((item) => `<option ${item === report.status ? "selected" : ""}>${item}</option>`).join("")}
        </select>
      </label>
    </article>
  `).join("");

  emptyState.hidden = visibleReports.length > 0;
  reportList.querySelectorAll(".status-control select").forEach((select) => {
    select.addEventListener("change", () => updateStatus(select));
  });
}

async function updateStatus(select) {
  select.disabled = true;
  try {
    await adminFetch(`/api/reports/${encodeURIComponent(select.dataset.reportId)}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: select.value }),
    });
    const report = reports.find((item) => item.id === select.dataset.reportId);
    if (report) report.status = select.value;
    setMessage(adminMessage, "Estado actualizado correctamente.", "");
  } catch (error) {
    setMessage(adminMessage, error.message, "error");
    await loadReports();
  } finally {
    select.disabled = false;
  }
}

function formatDate(value) {
  if (!value) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
