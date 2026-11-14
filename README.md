# Atención Ciudadana

Aplicación web en español para registrar quejas ciudadanas y darles seguimiento desde un panel municipal. Incluye una interfaz pública, un panel protegido por clave de administración, una API REST con Express y persistencia en Firebase Firestore.

## Requisitos

- Node.js 22 o posterior.
- Un proyecto de Firebase con Cloud Firestore habilitado.
- Una cuenta de servicio de Firebase para el backend local.

## Uso de Firebase en el plan gratuito

Las fotografías se optimizan en el navegador y se guardan como bytes junto con cada reporte en Firestore: la imagen principal queda limitada a 600 KB y la vista previa a 24 KB. Así, cada documento permanece por debajo del límite de 1 MiB y el proyecto no necesita Cloud Storage. Esto evita exigir Blaze: Cloud Storage for Firebase requiere el plan Blaze, aunque tenga cuotas gratuitas disponibles. Firestore incluye cuota gratuita diaria; revisa los límites vigentes antes de usarlo con muchos reportes.

- [Cuotas y límites de Firestore](https://firebase.google.com/docs/firestore/quotas)
- [Requisitos de facturación de Cloud Storage for Firebase](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)

## Configuración local

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` a `.env`.
3. En Firebase Console, crea una cuenta de servicio, descarga su archivo JSON y guárdalo localmente fuera de este repositorio.
4. Completa en `.env` el ID del proyecto, la ruta absoluta al JSON y una clave larga para el panel. En Windows, escribe las rutas con barras invertidas dobles, por ejemplo `C:\\Users\\tu-usuario\\firebase-service-account.json`.
5. En Firebase Console, crea una base de datos de Firestore en modo producción. Mantén las reglas de cliente cerradas: las operaciones se hacen desde el backend con la cuenta de servicio.
6. Ejecuta `npm start` y abre `http://localhost:3000`.

Si Firebase aún no está configurado, la interfaz se mostrará, pero las operaciones de reportes responderán con un error explícito de configuración.

## Flujo y API

- `POST /api/reports` recibe `multipart/form-data` (`name`, `category`, `location`, `description`, `photo` y `thumbnail`), valida los datos, guarda las imágenes y crea el reporte en `citizen_reports`.
- `GET /api/reports` lista los últimos 100 reportes y sus vistas previas; requiere la cabecera `x-admin-key`.
- `PATCH /api/reports/:id/status` actualiza el estado; requiere la misma clave.
- Los estados permitidos son `Recibida`, `En proceso` y `Resuelta`.
- El formulario acepta fotografías JPG, PNG y WebP de hasta 5 MB y las convierte a JPEG optimizado antes de enviarlas. El servidor limita los envíos a 10 por IP cada 15 minutos.

La clave compartida es una protección básica para el ejercicio, no un sistema de identidad municipal. Para producción, reemplázala por autenticación de usuarios (por ejemplo, Firebase Authentication con roles) y revisa la política de privacidad, cuotas, acceso y retención de datos. La cuenta de servicio y `.env` están excluidos de Git; nunca los publiques.

## Validación

`npm run check` comprueba la sintaxis de los archivos JavaScript sin necesitar conectarse a Firebase.
