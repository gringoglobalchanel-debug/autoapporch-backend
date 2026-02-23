/**
 * Servicio de WhatsApp con Twilio
 * Notificaciones automáticas vía WhatsApp
 */

import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886'; // Twilio Sandbox

/**
 * Formatear número de teléfono para WhatsApp
 * @param {string} phone - Número de teléfono
 * @returns {string} - Número formateado
 */
const formatWhatsAppNumber = (phone) => {
  if (phone.startsWith('whatsapp:')) {
    return phone;
  }
  
  let formatted = phone.replace(/\D/g, '');
  
  if (!formatted.startsWith('+')) {
    formatted = '+' + formatted;
  }
  
  return `whatsapp:${formatted}`;
};

/**
 * Notificar que una app está lista
 * @param {string} phone - Número de WhatsApp del usuario
 * @param {string} appName - Nombre de la app
 * @param {string} appId - ID de la app
 */
export const notifyAppReady = async (phone, appName, appId) => {
  if (!phone || !process.env.TWILIO_ACCOUNT_SID) {
    console.log('⚠️ WhatsApp notification skipped (no phone or Twilio not configured)');
    return { success: false, skipped: true };
  }

  try {
    const appUrl = `${process.env.CORS_ORIGIN}/apps/${appId}`;
    
    const message = await client.messages.create({
      from: WHATSAPP_FROM,
      to: formatWhatsAppNumber(phone),
      body: `🎉 *Your app is ready!*\n\n✨ *${appName}*\n\nYour app has been successfully generated and is ready to use.\n\n🔗 View it here: ${appUrl}\n\n_AutoAppOrchestrator_`,
    });

    console.log('✅ WhatsApp app ready notification sent:', message.sid);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error('❌ Error sending WhatsApp app ready notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Notificar fallo de pago
 * @param {string} phone - Número de WhatsApp
 * @param {string} amount - Monto del pago
 * @param {string} reason - Razón del fallo
 */
export const notifyPaymentFailed = async (phone, amount, reason) => {
  if (!phone || !process.env.TWILIO_ACCOUNT_SID) {
    console.log('⚠️ WhatsApp notification skipped (no phone or Twilio not configured)');
    return { success: false, skipped: true };
  }

  try {
    const message = await client.messages.create({
      from: WHATSAPP_FROM,
      to: formatWhatsAppNumber(phone),
      body: `⚠️ *Payment Failed*\n\n💳 Amount: $${amount}\n\n❌ Reason: ${reason}\n\nPlease update your payment method to continue using AutoAppOrchestrator.\n\n🔗 Update here: ${process.env.CORS_ORIGIN}/settings/billing\n\n_AutoAppOrchestrator_`,
    });

    console.log('✅ WhatsApp payment failed notification sent:', message.sid);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error('❌ Error sending WhatsApp payment failed notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Notificar error crítico
 * @param {string} phone - Número de WhatsApp
 * @param {string} appName - Nombre de la app
 * @param {string} errorMessage - Mensaje de error
 */
export const notifyCriticalError = async (phone, appName, errorMessage) => {
  if (!phone || !process.env.TWILIO_ACCOUNT_SID) {
    console.log('⚠️ WhatsApp notification skipped (no phone or Twilio not configured)');
    return { success: false, skipped: true };
  }

  try {
    const message = await client.messages.create({
      from: WHATSAPP_FROM,
      to: formatWhatsAppNumber(phone),
      body: `🚨 *Critical Error*\n\n📱 App: ${appName}\n\n❌ Error: ${errorMessage}\n\nWe're looking into this. You can try again or contact support.\n\n🔗 ${process.env.CORS_ORIGIN}/support\n\n_AutoAppOrchestrator_`,
    });

    console.log('✅ WhatsApp critical error notification sent:', message.sid);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error('❌ Error sending WhatsApp critical error notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Notificar actualización de plan
 * @param {string} phone - Número de WhatsApp
 * @param {string} planName - Nuevo plan
 */
export const notifyPlanUpgrade = async (phone, planName) => {
  if (!phone || !process.env.TWILIO_ACCOUNT_SID) {
    console.log('⚠️ WhatsApp notification skipped (no phone or Twilio not configured)');
    return { success: false, skipped: true };
  }

  try {
    const message = await client.messages.create({
      from: WHATSAPP_FROM,
      to: formatWhatsAppNumber(phone),
      body: `🎊 *Plan Upgraded!*\n\n✨ Welcome to ${planName}\n\nYou now have access to all ${planName} features. Happy building!\n\n🔗 ${process.env.CORS_ORIGIN}/dashboard\n\n_AutoAppOrchestrator_`,
    });

    console.log('✅ WhatsApp plan upgrade notification sent:', message.sid);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error('❌ Error sending WhatsApp plan upgrade notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Enviar mensaje personalizado de WhatsApp
 * @param {string} phone - Número de WhatsApp
 * @param {string} message - Mensaje a enviar
 */
export const sendCustomWhatsApp = async (phone, message) => {
  if (!phone || !process.env.TWILIO_ACCOUNT_SID) {
    console.log('⚠️ WhatsApp notification skipped (no phone or Twilio not configured)');
    return { success: false, skipped: true };
  }

  try {
    const result = await client.messages.create({
      from: WHATSAPP_FROM,
      to: formatWhatsAppNumber(phone),
      body: message,
    });

    console.log('✅ Custom WhatsApp message sent:', result.sid);
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('❌ Error sending custom WhatsApp message:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Verificar si WhatsApp está configurado
 * @returns {boolean}
 */
export const isWhatsAppEnabled = () => {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
};

export default {
  notifyAppReady,
  notifyPaymentFailed,
  notifyCriticalError,
  notifyPlanUpgrade,
  sendCustomWhatsApp,
  isWhatsAppEnabled,
};
