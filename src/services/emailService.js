/**
 * Servicio de Email Transaccional con Resend
 * Maneja todos los emails automatizados del sistema
 */

import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'AutoAppOrchestrator <noreply@autoapporch.com>';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'support@autoapporch.com';

/**
 * Enviar email de bienvenida a nuevo usuario
 * @param {string} email - Email del usuario
 * @param {string} fullName - Nombre completo
 * @param {string} userId - ID del usuario
 */
export const sendWelcomeEmail = async (email, fullName, userId) => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      replyTo: REPLY_TO,
      subject: 'Welcome to AutoAppOrchestrator! 🚀',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
            .feature { margin: 15px 0; padding-left: 25px; position: relative; }
            .feature:before { content: "✓"; position: absolute; left: 0; color: #667eea; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 32px;">Welcome to AutoAppOrchestrator! 🎉</h1>
            </div>
            <div class="content">
              <p>Hi ${fullName || 'there'},</p>
              
              <p>Welcome aboard! We're thrilled to have you join AutoAppOrchestrator, where AI meets app development.</p>
              
              <h2 style="color: #667eea;">What you can do now:</h2>
              <div class="feature">Create unlimited apps with AI-powered generation</div>
              <div class="feature">Get production-ready code in seconds</div>
              <div class="feature">Version control for all your apps</div>
              <div class="feature">Deploy with one click</div>
              
              <div style="text-align: center;">
                <a href="${process.env.CORS_ORIGIN}/dashboard" class="button">Go to Dashboard</a>
              </div>
              
              <p>Need help getting started? Check out our <a href="${process.env.CORS_ORIGIN}/docs">documentation</a> or reply to this email.</p>
              
              <p>Happy building!<br>The AutoAppOrchestrator Team</p>
            </div>
            <div class="footer">
              <p>AutoAppOrchestrator - Build apps with AI<br>
              <a href="${process.env.CORS_ORIGIN}/unsubscribe?id=${userId}">Unsubscribe</a></p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error('❌ Error sending welcome email:', error);
      return { success: false, error };
    }

    console.log('✅ Welcome email sent:', data.id);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('❌ Exception sending welcome email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Enviar email cuando una app está lista
 * @param {string} email - Email del usuario
 * @param {string} appName - Nombre de la app
 * @param {string} appId - ID de la app
 */
export const sendAppReadyEmail = async (email, appName, appId) => {
  try {
    const appUrl = `${process.env.CORS_ORIGIN}/apps/${appId}`;
    
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      replyTo: REPLY_TO,
      subject: `Your app "${appName}" is ready! 🎊`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; }
            .button { display: inline-block; background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .app-box { background: #f9fafb; border: 2px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 32px;">Your App is Ready! 🚀</h1>
            </div>
            <div class="content">
              <p>Great news!</p>
              
              <div class="app-box">
                <h2 style="margin: 0 0 10px 0; color: #10b981;">${appName}</h2>
                <p style="margin: 0; color: #6b7280;">Your app has been generated and is ready to use.</p>
              </div>
              
              <p><strong>What's next?</strong></p>
              <ul>
                <li>Review the generated code</li>
                <li>Download or deploy your app</li>
                <li>Request improvements if needed</li>
              </ul>
              
              <div style="text-align: center;">
                <a href="${appUrl}" class="button">View Your App</a>
              </div>
              
              <p>Questions? Just reply to this email!</p>
            </div>
            <div class="footer">
              <p>AutoAppOrchestrator - Build apps with AI</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error('❌ Error sending app ready email:', error);
      return { success: false, error };
    }

    console.log('✅ App ready email sent:', data.id);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('❌ Exception sending app ready email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Enviar email de error crítico
 * @param {string} email - Email del usuario
 * @param {string} appName - Nombre de la app
 * @param {string} errorMessage - Mensaje de error
 * @param {string} appId - ID de la app
 */
export const sendErrorEmail = async (email, appName, errorMessage, appId) => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      replyTo: REPLY_TO,
      subject: `Issue with "${appName}" - Action Required`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; }
            .error-box { background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; }
            .button { display: inline-block; background: #ef4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 32px;">Generation Issue</h1>
            </div>
            <div class="content">
              <p>We encountered an issue generating your app.</p>
              
              <div class="error-box">
                <strong>${appName}</strong><br>
                <p style="margin: 10px 0 0 0; color: #991b1b;">${errorMessage}</p>
              </div>
              
              <p><strong>What you can do:</strong></p>
              <ul>
                <li>Try regenerating with a more specific description</li>
                <li>Contact support for assistance</li>
                <li>Review your app requirements</li>
              </ul>
              
              <div style="text-align: center;">
                <a href="${process.env.CORS_ORIGIN}/apps/${appId}" class="button">View Details</a>
              </div>
              
              <p>Need help? Reply to this email or contact support@autoapporch.com</p>
            </div>
            <div class="footer">
              <p>AutoAppOrchestrator - Build apps with AI</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error('❌ Error sending error email:', error);
      return { success: false, error };
    }

    console.log('✅ Error email sent:', data.id);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('❌ Exception sending error email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Enviar email de facturación
 * @param {string} email - Email del usuario
 * @param {string} type - Tipo: 'success', 'failed', 'cancelled'
 * @param {Object} details - Detalles del pago
 */
export const sendBillingEmail = async (email, type, details) => {
  const subjects = {
    success: 'Payment Confirmed - Thank You! 💳',
    failed: 'Payment Failed - Action Required',
    cancelled: 'Subscription Cancelled',
  };

  const colors = {
    success: '#10b981',
    failed: '#ef4444',
    cancelled: '#f59e0b',
  };

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      replyTo: REPLY_TO,
      subject: subjects[type] || 'Billing Update',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: ${colors[type]}; color: white; padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; }
            .billing-box { background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .amount { font-size: 32px; font-weight: bold; color: ${colors[type]}; }
            .button { display: inline-block; background: ${colors[type]}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 32px;">${subjects[type]}</h1>
            </div>
            <div class="content">
              ${type === 'success' ? `
                <p>Thank you for your payment!</p>
                <div class="billing-box">
                  <div class="amount">$${details.amount}</div>
                  <p style="margin: 10px 0 0 0; color: #6b7280;">
                    ${details.plan} Plan - ${details.interval}<br>
                    Invoice: ${details.invoiceId}
                  </p>
                </div>
                <p>Your subscription is now active. You have full access to all ${details.plan} features.</p>
              ` : type === 'failed' ? `
                <p>We were unable to process your payment.</p>
                <div class="billing-box">
                  <p><strong>Amount:</strong> $${details.amount}<br>
                  <strong>Card:</strong> ${details.cardLast4 || '****'}<br>
                  <strong>Reason:</strong> ${details.reason || 'Payment declined'}</p>
                </div>
                <p>Please update your payment method to continue using AutoAppOrchestrator.</p>
                <div style="text-align: center;">
                  <a href="${process.env.CORS_ORIGIN}/settings/billing" class="button">Update Payment Method</a>
                </div>
              ` : `
                <p>Your subscription has been cancelled.</p>
                <p>You'll continue to have access until ${details.periodEnd}.</p>
                <p>We're sorry to see you go. If you have any feedback, please let us know.</p>
              `}
            </div>
            <div class="footer">
              <p>AutoAppOrchestrator - Build apps with AI</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error('❌ Error sending billing email:', error);
      return { success: false, error };
    }

    console.log('✅ Billing email sent:', data.id);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('❌ Exception sending billing email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Enviar email genérico personalizado
 * @param {string} to - Destinatario
 * @param {string} subject - Asunto
 * @param {string} html - Contenido HTML
 */
export const sendCustomEmail = async (to, subject, html) => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      replyTo: REPLY_TO,
      subject,
      html,
    });

    if (error) {
      console.error('❌ Error sending custom email:', error);
      return { success: false, error };
    }

    console.log('✅ Custom email sent:', data.id);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('❌ Exception sending custom email:', error);
    return { success: false, error: error.message };
  }
};

export default {
  sendWelcomeEmail,
  sendAppReadyEmail,
  sendErrorEmail,
  sendBillingEmail,
  sendCustomEmail,
};
