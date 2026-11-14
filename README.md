# Atención Ciudadana

Aplicación web en español para registrar quejas ciudadanas y darles seguimiento desde un panel municipal. Incluye una interfaz pública, un panel protegido por clave de administración, una API REST con Express y persistencia en Firebase Firestore y Firebase Storage.

## Requisitos

- Node.js 20 o posterior.
- Un proyecto de Firebase con Firestore y Firebase Storage habilitados.
- Una cuenta de servicio de Firebase para el backend local.

## Configuración local

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` a `.env`.
3. En Firebase Console, crea una cuenta de servicio, descarga su archivo JSON y guárdalo localmente fuera de este repositorio.
4. Completa en `.env` el ID del proyecto, el nombre del bucket de Storage, la ruta absoluta al JSON y una clave larga para el panel. En Windows, escribe las rutas con barras invertidas dobles, por ejemplo `C:\\Users\\tu-usuario\\firebase-service-account.json`.
5. En Firebase Console, crea Firestore en modo producción y habilita Firebase Storage. Mantén las reglas de cliente cerradas: las operaciones se hacen desde el backend con la cuenta de servicio.
6. Ejecuta `npm start` y abre `http://localhost:3000`.

Si Firebase aún no está configurado, la interfaz se mostrará, pero las operaciones de reportes responderán con un error explícito de configuración.

## Flujo y API

- `POST /api/reports` recibe `multipart/form-data` (`name`, `category`, `location`, `description` y `photo`), valida los datos, almacena la imagen y crea el reporte en `citizen_reports`.
- `GET /api/reports` lista los últimos 200 reportes y sus fotografías; requiere la cabecera `x-admin-key`.
- `PATCH /api/reports/:id/status` actualiza el estado; requiere la misma clave.
- Los estados permitidos son `Recibida`, `En proceso` y `Resuelta`.
- El formulario acepta fotografías JPG, PNG y WebP de hasta 5 MB. El servidor limita los envíos a 10 por IP cada 15 minutos.

La clave compartida es una protección básica para el ejercicio, no un sistema de identidad municipal. Para producción, reemplázala por autenticación de usuarios (por ejemplo, Firebase Authentication con roles) y revisa la política de privacidad, cuotas, acceso y retención de datos.

## Validación

`npm run check` comprueba la sintaxis de los archivos JavaScript sin necesitar conectarse a Firebase.
