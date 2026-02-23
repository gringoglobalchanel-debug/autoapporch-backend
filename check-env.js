import dotenv from 'dotenv';
dotenv.config();

const requiredVars = [
  "CLAUDE_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "STRIPE_KEY",
  "RESEND_API_KEY",
  "TWILIO_SID",
  "TWILIO_AUTH_TOKEN"
];

let missing = [];

requiredVars.forEach(key => {
  if (!process.env[key]) {
    missing.push(key);
  }
});

if (missing.length > 0) {
  console.error("❌ Faltan estas variables en tu .env:");
  missing.forEach(k => console.error(` - ${k}`));
  process.exit(1);
} else {
  console.log("✅ Todas las variables de entorno están definidas correctamente.");
}
