require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { applicationDefault, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const helmet = require("helmet");
const multer = require("multer");

const app = express();
const port = Number(process.env.PORT) || 3000;
const allowedCategories = new Set([
  "Alumbrado público",
  "Agua y drenajes",
  "Calles y banquetas",
  "Recolección de basura",
  "Parques y áreas verdes",
  "Otro",
]);
const allowedStatuses = new Set(["Recibida", "En proceso", "Resuelta"]);
const maxPhotoBytes = 5 * 1024 * 1024;
const firebaseConfigured = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_STORAGE_BUCKET &&
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
);

let db;
let bucket;

if (firebaseConfigured) {
  const firebaseApp =
    getApps()[0] ||
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  db = getFirestore(firebaseApp);
  bucket = getStorage(firebaseApp).bucket();
} else {
  console.warn(
    "Firebase no está configurado. La interfaz estará disponible, pero la API de reportes responderá 503. Completa las variables de .env.",
  );
}

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "blob:", "https:"],
      },
    },
  }),
);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxPhotoBytes, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.mimetype)) {
      callback(new Error("La fotografía debe estar en formato JPG, PNG o WebP."));
      return;
    }
    callback(null, true);
  },
});

const submissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Se alcanzó el límite de envíos. Intenta de nuevo más tarde." },
});

function requireFirebase(_request, _response, next) {
  if (!firebaseConfigured) {
    next(
      Object.assign(new Error("El servidor aún no está configurado con Firebase."), {
        status: 503,
      }),
    );
    return;
  }
  next();
}

function requireAdmin(request, _response, next) {
  const expected = process.env.ADMIN_API_KEY || "";
  const supplied = request.get("x-admin-key") || "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    !expected ||
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    next(Object.assign(new Error("Clave de administración incorrecta o no configurada."), { status: 401 }));
    return;
  }
  next();
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function toIsoString(value) {
  return value && typeof value.toDate === "function" ? value.toDate().toISOString() : null;
}

async function toReport(document) {
  const report = document.data();
  let photoUrl = null;

  if (report.photoPath) {
    [photoUrl] = await bucket.file(report.photoPath).getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });
  }

  return {
    id: document.id,
    name: report.name,
    category: report.category,
    location: report.location,
    description: report.description,
    status: report.status,
    photoUrl,
    createdAt: toIsoString(report.createdAt),
    updatedAt: toIsoString(report.updatedAt),
  };
}

app.post(
  "/api/reports",
  submissionLimiter,
  requireFirebase,
  upload.single("photo"),
  async (request, response, next) => {
    let photoPath;
    try {
      const name = cleanText(request.body.name, 100);
      const category = cleanText(request.body.category, 60);
      const location = cleanText(request.body.location, 160);
      const description = cleanText(request.body.description, 2000);

      if (!name || !location || description.length < 15 || !allowedCategories.has(category)) {
        response.status(400).json({
          error: "Revisa los campos: nombre, categoría, ubicación y una descripción de al menos 15 caracteres.",
        });
        return;
      }
      if (!request.file) {
        response.status(400).json({ error: "Adjunta una fotografía relacionada con el reporte." });
        return;
      }

      const reportRef = db.collection("citizen_reports").doc();
      const extension = request.file.mimetype.split("/")[1].replace("jpeg", "jpg");
      photoPath = `reports/${reportRef.id}/${crypto.randomUUID()}.${extension}`;
      await bucket.file(photoPath).save(request.file.buffer, {
        resumable: false,
        metadata: { contentType: request.file.mimetype },
      });

      await reportRef.set({
        name,
        category,
        location,
        description,
        photoPath,
        status: "Recibida",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      response.status(201).json({ id: reportRef.id, message: "Tu reporte fue registrado correctamente." });
    } catch (error) {
      if (photoPath) {
        await bucket.file(photoPath).delete({ ignoreNotFound: true }).catch((cleanupError) => {
          console.error("No se pudo limpiar la fotografía tras un error al guardar el reporte:", cleanupError);
        });
      }
      next(error);
    }
  },
);

app.get("/api/reports", requireFirebase, requireAdmin, async (request, response, next) => {
  try {
    const snapshot = await db
      .collection("citizen_reports")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    const reports = await Promise.all(snapshot.docs.map(toReport));
    response.json({ reports });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/reports/:id/status", requireFirebase, requireAdmin, async (request, response, next) => {
  try {
    const status = cleanText(request.body.status, 30);
    if (!allowedStatuses.has(status)) {
      response.status(400).json({ error: "El estado seleccionado no es válido." });
      return;
    }

    const reportRef = db.collection("citizen_reports").doc(request.params.id);
    const report = await reportRef.get();
    if (!report.exists) {
      response.status(404).json({ error: "No se encontró el reporte solicitado." });
      return;
    }

    await reportRef.update({ status, updatedAt: FieldValue.serverTimestamp() });
    response.json({ message: "Estado actualizado correctamente." });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(400).json({ error: "La fotografía no puede superar los 5 MB." });
    return;
  }
  if (error.message && error.message.startsWith("La fotografía")) {
    response.status(400).json({ error: error.message });
    return;
  }

  const status = Number(error.status) || 500;
  if (status >= 500) console.error("Error en la API:", error);
  response.status(status).json({
    error: status >= 500 ? "Ocurrió un error al procesar la solicitud. Intenta de nuevo." : error.message,
  });
});

app.listen(port, () => {
  console.log(`Atención Ciudadana disponible en http://localhost:${port}`);
});
