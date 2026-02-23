# AutoAppOrchestrator Backend

API REST construida con Express.js para AutoAppOrchestrator.

## 📁 Estructura

```
backend/
├── src/
│   ├── config/         # Configuración (DB, etc.)
│   ├── middleware/     # Middleware (auth, errors, etc.)
│   ├── routes/         # Rutas de la API
│   ├── services/       # Servicios (Claude, Stripe, etc.)
│   └── server.js       # Punto de entrada
├── package.json
└── .env
```

## 🚀 Inicio Rápido

```bash
# Instalar dependencias
npm install

# Configurar .env
cp .env.example .env
# Editar .env con tus credenciales

# Ejecutar en desarrollo
npm run dev

# Ejecutar en producción
npm start
```

## 🔌 Endpoints

### Autenticación
- `POST /api/auth/register` - Registrar usuario
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/logout` - Cerrar sesión
- `POST /api/auth/refresh` - Refrescar token
- `POST /api/auth/forgot-password` - Solicitar reset
- `POST /api/auth/reset-password` - Resetear password

### Apps
- `GET /api/apps` - Listar apps del usuario
- `GET /api/apps/:id` - Obtener app por ID
- `POST /api/apps/create` - Generar nueva app
- `POST /api/apps/:id/improve` - Mejorar app existente
- `DELETE /api/apps/:id` - Eliminar app
- `GET /api/apps/:id/versions/:version` - Obtener versión específica

### Usuarios
- `GET /api/users/me` - Obtener perfil
- `PUT /api/users/me` - Actualizar perfil
- `GET /api/users/stats` - Estadísticas
- `GET /api/users/activity` - Actividad reciente
- `GET /api/users/limits` - Límites del plan
- `DELETE /api/users/me` - Eliminar cuenta

### Stripe
- `GET /api/stripe/plans` - Obtener planes
- `POST /api/stripe/create-checkout-session` - Crear checkout
- `POST /api/stripe/create-portal-session` - Crear portal
- `GET /api/stripe/subscription` - Obtener suscripción
- `POST /api/stripe/webhook` - Webhook de Stripe

## 🔒 Autenticación

Usa Bearer tokens de Supabase:

```javascript
headers: {
  'Authorization': 'Bearer YOUR_ACCESS_TOKEN'
}
```

## 🧪 Testing

```bash
npm test
```

## 📝 Variables de Entorno

Ver `.env.example` para lista completa.

Esenciales:
- `DATABASE_URL` - PostgreSQL connection string
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service key
- `ANTHROPIC_API_KEY` - Claude API key
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret

## 🐛 Debug

```bash
# Ver logs en desarrollo
npm run dev

# Ver logs en producción
pm2 logs
```

## 📚 Documentación

Ver documentación completa en `/docs` del repositorio principal.
