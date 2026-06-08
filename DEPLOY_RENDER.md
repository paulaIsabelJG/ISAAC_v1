# Guía de despliegue ISAAC en Render

> Esta guía asume que el código ya está en un repositorio GitHub/GitLab.
> Los servicios gratuitos de Render se "duermen" tras 15 min de inactividad:
> la primera petición puede tardar 30-60 s en despertar.

---

## A. MongoDB Atlas (base de datos)

1. Entrar en [https://cloud.mongodb.com](https://cloud.mongodb.com) y crear una cuenta gratuita.
2. Crear un **Cluster** (Free M0 es suficiente para pruebas).
3. En **Database Access** → Add Database User:
   - Usuario: `isaac`
   - Password: genera una contraseña segura y guárdala.
   - Role: `Atlas admin` (o `readWriteAnyDatabase`).
4. En **Network Access** → Add IP Address:
   - Pulsar "Allow Access from Anywhere" (`0.0.0.0/0`).
   - Necesario porque Render no tiene IPs fijas en el plan gratuito.
5. En **Database** → Connect → Drivers → copiar el **Connection String**:
   ```
   mongodb+srv://isaac:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Sustituir `<password>` por la contraseña real y añadir el nombre de la base de datos:
   ```
   mongodb+srv://isaac:MI_PASSWORD@cluster0.xxxxx.mongodb.net/isaac?retryWrites=true&w=majority
   ```
   Guardar este valor como `MONGO_URI`.

---

## B. Backend en Render (Web Service)

### Configuración en el dashboard

1. En [https://render.com](https://render.com) → **New** → **Web Service**.
2. Conectar el repositorio GitHub/GitLab.
3. Configurar:
   | Campo | Valor |
   |---|---|
   | Name | `isaac-backend` (o el nombre que quieras) |
   | Root Directory | `backend` |
   | Environment | `Node` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | Free |

### Variables de entorno (Environment → Add Environment Variable)

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI` | `mongodb+srv://isaac:PASSWORD@cluster.mongodb.net/isaac?retryWrites=true&w=majority` |
| `JWT_SECRET` | cadena aleatoria larga (p.ej. genera una en [https://generate-secret.vercel.app/64](https://generate-secret.vercel.app/64)) |
| `OPENAI_API_KEY` | `sk-...` (tu clave de OpenAI) |
| `OPENAI_MODEL` | `gpt-4o-mini` |
| `FRONTEND_URL` | URL del frontend tras desplegarlo (paso C) — rellenar después |
| `VOICE_ENABLED` | `false` (el voice_service no se despliega en Render por sus dependencias ML) |

4. Pulsar **Create Web Service**.
5. Esperar a que el build termine. Render mostrará la URL:
   ```
   https://isaac-backend.onrender.com
   ```
   Guardar esta URL.

---

## C. Frontend en Render (Static Site)

### Antes de crear el Static Site: actualizar la URL del backend

1. Editar [ISAAC_app1/src/environments/environment.prod.ts](ISAAC_app1/src/environments/environment.prod.ts):
   ```typescript
   export const environment = {
     production: true,
     apiUrl: 'https://isaac-backend.onrender.com/api',  // ← URL real del backend
   };
   ```
2. Hacer commit y push del cambio.

### Configuración en el dashboard

1. En Render → **New** → **Static Site**.
2. Conectar el mismo repositorio.
3. Configurar:
   | Campo | Valor |
   |---|---|
   | Name | `isaac-frontend` |
   | Root Directory | `ISAAC_app1` |
   | Build Command | `npm install && npm run build` |
   | Publish Directory | `www` |

4. Pulsar **Create Static Site**.
5. Render ejecutará el build y dará la URL pública:
   ```
   https://isaac-frontend.onrender.com
   ```

### Actualizar FRONTEND_URL en el backend

1. Volver al Web Service del backend → Environment.
2. Editar `FRONTEND_URL` y poner `https://isaac-frontend.onrender.com`.
3. El backend se redesplegará automáticamente con el CORS correcto.

---

## D. Voice Service Python/FastAPI

> **El voice_service NO se puede desplegar en Render** con el plan estándar porque requiere:
> - PyTorch (~2 GB)
> - OpenVoice (clonar repositorio manualmente)
> - MeloTTS (clonar repositorio manualmente)
> - Checkpoints ML (~varios GB)
>
> Estos requisitos superan los límites de RAM/disco del plan gratuito y no son
> instalables con un simple `pip install -r requirements.txt`.
>
> **Alternativas:**
> - Ejecutar el voice_service localmente mientras pruebas.
> - Deshabilitar la funcionalidad de voz personalizada en producción (`VOICE_ENABLED=false`).
> - En el futuro, desplegarlo en un servidor con GPU/más RAM (Railway, Fly.io, AWS EC2).

Si en el futuro se despliega:
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Variable de entorno en el backend:** `PYTHON_VOICE_URL=https://isaac-voice.onrender.com`

---

## E. Probar desde una tablet

1. Abrir el navegador de la tablet.
2. Entrar en `https://isaac-frontend.onrender.com`.
3. Comprobar que carga la pantalla de login.
4. **Login:** crear una cuenta o usar una existente de la base de datos Atlas.
5. **Tableros:** abrir un tablero y verificar que los pictogramas cargan.
6. **Predictor:** usar el comunicador y ver que las sugerencias aparecen.
7. **Corrector IA:** construir una frase, pulsar Hablar y verificar que el corrector responde.
8. **Imágenes ARASAAC:** comprobar que las imágenes de pictogramas cargan desde arasaac.org.
9. **Voz:** si `VOICE_ENABLED=false`, la voz personalizada no funcionará; la voz del sistema sí.

---

## F. Problemas comunes

### CORS bloqueado
- Síntoma: el navegador muestra `CORS error` en la consola.
- Causa: `FRONTEND_URL` no está configurada en el backend, o tiene una barra `/` al final.
- Solución: en el backend de Render, verificar que `FRONTEND_URL=https://isaac-frontend.onrender.com` (sin barra final).

### MONGO_URI incorrecta
- Síntoma: el backend arranca pero da `MongoDB connection error`.
- Causa: contraseña mal copiada, nombre de base de datos faltante, o IPs no permitidas en Atlas.
- Solución: revisar la cadena de conexión y que `0.0.0.0/0` esté en Network Access de Atlas.

### Backend dormido (Free tier)
- Síntoma: la primera petición tarda 30-60 segundos.
- Causa: Render apaga los servicios gratuitos tras 15 min sin tráfico.
- Solución: normal en el plan gratuito. Para evitarlo, usar el plan Starter ($7/mes) o hacer un ping periódico.

### `environment.prod.ts` apunta a localhost
- Síntoma: el frontend carga pero todas las llamadas API fallan.
- Causa: `environment.prod.ts` tiene `http://localhost:4000/api`.
- Solución: actualizar con la URL real del backend y hacer commit + push.

### Variables de entorno no configuradas
- Síntoma: `JWT_SECRET` o `MONGO_URI` sin valor → el backend falla al arrancar.
- Solución: en Render → Web Service → Environment, asegurarse de que todas las variables tienen valor.

### Error de build Angular
- Síntoma: el build falla con errores de TypeScript o dependencias.
- Causa habitual: versión de Node.js incorrecta. Render usa Node 18 por defecto.
- Solución: en el Static Site → Environment, añadir `NODE_VERSION=20` (Angular 20 requiere Node 20+).

### Voice service sin `$PORT`
- Ya corregido: el `main.py` ahora lee `os.environ.get("PORT", 8000)`.

---

## G. Resumen de URLs

Tras el despliegue tendrás:

| Servicio | URL |
|---|---|
| Backend API | `https://isaac-backend.onrender.com` |
| Frontend | `https://isaac-frontend.onrender.com` |
| Voice service | No desplegado (local o deshabilitado) |

Sustituye `isaac-backend` e `isaac-frontend` por los nombres reales que hayas elegido en Render.
