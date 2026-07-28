# Glosario técnico — MoneyTracker

## Auth / OAuth

- **OAuth**: protocolo que le permite a la app pedirle a Google "dejame actuar en nombre de este usuario" sin que la app vea la contraseña.
- **Scope**: el permiso específico que se pide dentro de un OAuth (ej. `gmail.readonly` = solo leer mails, no enviarlos ni borrarlos).
- **Access token**: credencial de corta duración (minutos/horas) que se usa para llamar a una API (ej. Gmail) en nombre del usuario.
- **Refresh token**: credencial de larga duración que sirve para pedir nuevos access tokens sin que el usuario vuelva a loguearse. Es lo que guardamos en `gmail_connections` para poder escanear Gmail en segundo plano.
- **`access_type=offline` / `prompt=consent`**: parámetros que le piden a Google que además del access token te devuelva un refresh token reutilizable (por defecto no lo hace).
- **JWT (JSON Web Token)**: token con formato `header.payload.signature` que codifica datos (ej. `role: anon`) de forma verificable. El anon key y el service role key de Supabase son JWTs.
- **OAuth consent screen / "Testing" vs "Production"**: pantalla de Google Cloud donde se declara qué hace tu app y qué scopes pide. En modo Testing solo la pueden usar usuarios que vos agregues a mano ("test users"), sin pasar por la revisión de seguridad (CASA) que Google exige para apps públicas con scopes sensibles como `gmail.readonly`.

## Supabase / Base de datos

- **RLS (Row Level Security)**: reglas a nivel de Postgres que filtran qué filas puede ver/tocar cada usuario. Es lo que hace que, en una sola base de datos compartida, cada usuario solo vea sus propias transacciones.
- **anon key**: clave pública que usa el frontend; respeta las políticas de RLS (o sea, no da acceso libre a todo).
- **service role key**: clave secreta que **bypassea** RLS por completo. Solo se usa server-side (en las funciones de `/api`), nunca en el navegador.
- **`auth.uid()`**: función de Postgres/Supabase que devuelve el ID del usuario logueado; es la base de casi todas las políticas de RLS del proyecto (`auth.uid() = user_id`).
- **Migration**: archivo SQL versionado (`supabase/migrations/0001_init.sql`) que define/modifica el schema de la base de forma reproducible.
- **View con `security_invoker`**: una "vista" de SQL que, en vez de correr con los permisos de quien la creó, corre con los permisos de quien la consulta — así `gmail_connection_status` puede aplicar RLS por usuario en vez de exponer todo.

## Backend / Vercel

- **Serverless function**: código backend (`/api/*.ts`) que Vercel ejecuta bajo demanda, sin mantener un servidor corriendo 24/7.
- **Cron job**: tarea programada para correr sola cada cierto tiempo (`api/cron/scan-gmail.ts`, disparada según el schedule en `vercel.ts`).
- **Webhook**: notificación automática que un sistema le manda a otro cuando pasa algo (ej. GitHub avisándole a Vercel "hubo un push" para que dispare un deploy).
- **Environment variable (env var)**: valor de configuración/secreto que vive fuera del código (`SUPABASE_URL`, `CRON_SECRET`, etc.), cargado distinto en local (`.env`) y en Vercel (dashboard).
- **`VITE_*` prefix**: convención de Vite — cualquier env var con ese prefijo queda embebida en el bundle público del frontend. Por eso el service role key **nunca** lleva ese prefijo.
- **Deploy / Production vs Preview**: cada push genera un deploy; el de la rama `main` va a Production (URL final), el resto a Preview (URLs temporales para probar).

## LLM / Categorización

- **LLM (Large Language Model)**: el modelo de IA (ej. Claude) que usamos para leer el texto del mail y extraer/categorizar datos.
- **Structured output**: en vez de pedirle al LLM texto libre, se le pide que devuelva datos con una forma exacta predefinida (ver `zod` schema abajo). Reduce errores de formato.
- **`generateObject` (AI SDK)**: función que llama al LLM y fuerza que la respuesta cumpla un schema, en vez de un chat de texto libre.
- **Zod / schema**: librería para definir "la forma que debe tener un dato" (tipos, campos obligatorios) y validarla en tiempo de ejecución — es lo que le da la estructura al `generateObject`.
- **AI Gateway**: capa de Vercel que enruta las llamadas al LLM (acá a Claude) sin que la app necesite guardar su propia API key — se autentica sola vía OIDC en producción.
- **Confidence / `needs_review`**: puntaje 0–1 que devuelve el LLM indicando qué tan seguro está de la categoría asignada; si es bajo, la transacción se marca para revisión manual.

## Frontend

- **SPA (Single Page Application)**: la app carga una sola vez y después navega entre pantallas sin recargar el navegador (lo hace `react-router-dom`).
- **Vite**: la herramienta que compila y sirve el código React/TS durante desarrollo y para producción (alternativa más rápida a Create React App/Webpack).
