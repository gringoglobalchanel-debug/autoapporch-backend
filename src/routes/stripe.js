/**
 * Rutas de integración con Stripe
 * Maneja suscripciones, checkout y webhooks
 * VERSIÓN V2 - Con suspensión/reactivación automática de apps
 */

import express from 'express';
import { query, transaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import Stripe from 'stripe';
import * as deploymentService from '../services/deploymentService.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_51Sycnn96aBqW1Ydc12uPONa3JBK2CwXkjOFJJ2UD90akVG0lLOETVo5EQ3caaVavupBH8jQb6D2WkS6JZjlG07Fy00SqHt4hHQ');

/**
 * GET /api/stripe/plans
 * Obtener planes de precios disponibles
 */
router.get('/plans', asyncHandler(async (req, res) => {
  const plans = [
    {
      id: 'basico',
      name: 'Básico',
      price: 29.99,
      currency: 'usd',
      interval: 'month',
      price_id: process.env.STRIPE_PRICE_BASICO || 'price_1Szpa696aBqW1Ydcw4dE3LJH',
      features: [
        '3 apps desplegadas',
        '50,000 tokens/mes',
        'Deploy automático',
        'Dominio .vercel.app',
        'SSL gratis',
        'Soporte por email'
      ]
    },
    {
      id: 'premium',
      name: 'Premium',
      price: 49.99,
      currency: 'usd',
      interval: 'month',
      price_id: process.env.STRIPE_PRICE_PREMIUM || 'price_1SzpgR96aBqW1YdcVNCU25WV',
      features: [
        '8 apps desplegadas',
        '150,000 tokens/mes',
        'Deploy automático',
        '1 dominio personalizado incluido',
        'SSL gratis',
        'Backups automáticos',
        'Google Maps incluido',
        'Soporte prioritario'
      ]
    },
    {
      id: 'pro',
      name: 'Pro',
      price: 99.99,
      currency: 'usd',
      interval: 'month',
      price_id: process.env.STRIPE_PRICE_PRO || 'price_1SzpiL96aBqW1Ydc3MqRQtD8',
      features: [
        '25 apps desplegadas',
        '500,000 tokens/mes',
        'Deploy automático',
        '5 dominios personalizados incluidos',
        'SSL gratis',
        'Backups automáticos',
        'Google Maps incluido',
        'API prioritario',
        'Soporte 24/7',
        'Dominios extras +$5/mes'
      ]
    }
  ];
  
  res.json({ success: true, plans });
}));

/**
 * POST /api/stripe/create-checkout
 * Crear sesión de checkout para suscripción (nueva o upgrade)
 */
router.post('/create-checkout', authenticate, asyncHandler(async (req, res) => {
  const { plan } = req.query;

  if (!plan) {
    return res.status(400).json({
      success: false,
      message: 'Por favor selecciona un plan',
      friendlyMessage: 'No hemos recibido el plan que deseas contratar. Intenta de nuevo.'
    });
  }

  // Mapear plan a price_id y límites
  let priceId;
  let planName;
  let appsAllowed;
  let tokenLimit;
  let domainsAllowed;

  switch (plan) {
    case 'basico':
      priceId = process.env.STRIPE_PRICE_BASICO || 'price_1Szpa696aBqW1Ydcw4dE3LJH';
      planName = 'basico';
      appsAllowed = 3;
      tokenLimit = 50000;
      domainsAllowed = 0;
      break;
    case 'premium':
      priceId = process.env.STRIPE_PRICE_PREMIUM || 'price_1SzpgR96aBqW1YdcVNCU25WV';
      planName = 'premium';
      appsAllowed = 8;
      tokenLimit = 150000;
      domainsAllowed = 1;
      break;
    case 'pro':
      priceId = process.env.STRIPE_PRICE_PRO || 'price_1SzpiL96aBqW1Ydc3MqRQtD8';
      planName = 'pro';
      appsAllowed = 25;
      tokenLimit = 500000;
      domainsAllowed = 5;
      break;
    default:
      return res.status(400).json({
        success: false,
        message: 'Plan no válido',
        friendlyMessage: 'El plan seleccionado no existe. Por favor elige una opción válida.'
      });
  }

  console.log('🔍 Plan seleccionado:', plan);
  console.log('🔍 Price ID:', priceId);
  console.log('🔍 User ID:', req.user.id);
  console.log('🔍 User Email:', req.user.email);

  // Verificar si ya tiene suscripción activa
  const existingSub = await query(
    `SELECT * FROM subscriptions 
     WHERE user_id = $1 AND status IN ('active', 'trialing')`,
    [req.user.id]
  );

  // Si ya tiene suscripción, crear checkout para upgrade
  if (existingSub.rows.length > 0) {
    const currentSub = existingSub.rows[0];
    
    console.log('📌 Usuario ya tiene suscripción activa. Plan actual:', currentSub.plan);
    console.log('📌 Solicitando cambio a:', planName);

    if (currentSub.stripe_customer_id && currentSub.stripe_customer_id.trim() !== '') {
      try {
        // Obtener el ID del item de suscripción en Stripe
        const stripeSub = await stripe.subscriptions.retrieve(currentSub.stripe_subscription_id);
        const subscriptionItemId = stripeSub.items.data[0].id;

        // Crear sesión de checkout para actualización
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          customer: currentSub.stripe_customer_id,
          // 👇 CÓDIGOS PROMOCIONALES ACTIVADOS PARA UPGRADE
          allow_promotion_codes: true,
          subscription_data: {
            items: [{ id: subscriptionItemId, price: priceId }],
            metadata: {
              userId: req.user.id,
              plan: planName,
              isUpgrade: 'true',
              previousPlan: currentSub.plan
            }
          },
          success_url: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/dashboard?upgrade_success=true&plan=${plan}`,
          cancel_url: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/billing?upgrade_canceled=true`,
          metadata: {
            userId: req.user.id,
            plan: planName,
            isUpgrade: 'true',
            previousPlan: currentSub.plan,
            appsAllowed: appsAllowed.toString(),
            tokenLimit: tokenLimit.toString(),
            domainsAllowed: domainsAllowed.toString()
          }
        });

        console.log('✅ Sesión de UPGRADE creada:', session.id);
        
        return res.json({
          success: true,
          sessionId: session.id,
          url: session.url,
          isUpgrade: true,
          message: 'Te redirigimos a Stripe para actualizar tu plan'
        });

      } catch (upgradeError) {
        console.error('❌ Error creando sesión de upgrade:', upgradeError);
        
        // Fallback al portal
        try {
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: currentSub.stripe_customer_id,
            return_url: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/billing`
          });

          return res.json({
            success: true,
            url: portalSession.url,
            isPortal: true,
            message: 'Te redirigimos al portal de Stripe para gestionar tu suscripción'
          });
        } catch (portalError) {
          return res.status(500).json({
            success: false,
            message: 'Error al gestionar tu suscripción',
            friendlyMessage: 'No pudimos conectar con Stripe. Por favor intenta de nuevo en unos minutos.'
          });
        }
      }
    }
  }

  // FLUJO PARA USUARIO NUEVO
  let customerId = null;
  
  try {
    const existingCustomer = await stripe.customers.list({
      email: req.user.email,
      limit: 1
    });

    if (existingCustomer.data.length > 0) {
      customerId = existingCustomer.data[0].id;
      console.log('🔍 Cliente existente encontrado:', customerId);
    }
  } catch (customerError) {
    console.error('⚠️ Error buscando cliente:', customerError.message);
  }

  try {
    const sessionParams = {
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/dashboard?success=true&plan=${plan}`,
      cancel_url: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/billing?canceled=true`,
      // 👇 CÓDIGOS PROMOCIONALES ACTIVADOS PARA NUEVOS USUARIOS
      allow_promotion_codes: true,
      metadata: {
        userId: req.user.id,
        plan: planName,
        appsAllowed: appsAllowed.toString(),
        tokenLimit: tokenLimit.toString(),
        domainsAllowed: domainsAllowed.toString()
      },
      subscription_data: {
        metadata: {
          userId: req.user.id,
          plan: planName
        }
      }
    };

    if (customerId && customerId.trim() !== '') {
      sessionParams.customer = customerId;
    } else {
      sessionParams.customer_email = req.user.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log('✅ Sesión de checkout creada:', session.id);

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url,
      message: 'Te redirigimos a Stripe para completar el pago'
    });

  } catch (stripeError) {
    console.error('❌ Error creando sesión de checkout:', stripeError);
    
    let friendlyMessage = 'Error al procesar el pago. Intenta de nuevo.';
    
    if (stripeError.message?.includes('price')) {
      friendlyMessage = 'Error de configuración del plan. Contacta a soporte.';
    } else if (stripeError.message?.includes('customer')) {
      friendlyMessage = 'Error con los datos del cliente. Por favor inicia sesión de nuevo.';
    } else if (stripeError.message?.includes('connection')) {
      friendlyMessage = 'Error de conexión con Stripe. Intenta en unos minutos.';
    }
    
    throw new AppError(friendlyMessage, 500);
  }
}));

/**
 * POST /api/stripe/create-portal
 * Crear sesión del portal del cliente
 */
router.post('/create-portal', authenticate, asyncHandler(async (req, res) => {
  const subResult = await query(
    `SELECT stripe_customer_id FROM subscriptions 
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );

  if (subResult.rows.length === 0 || !subResult.rows[0].stripe_customer_id) {
    return res.status(404).json({
      success: false,
      message: 'No tienes una suscripción activa',
      friendlyMessage: 'No encontramos una suscripción activa para gestionar. ¿Quieres contratar un plan?'
    });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subResult.rows[0].stripe_customer_id,
      return_url: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/dashboard`
    });

    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('❌ Error creating portal session:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error al abrir el portal',
      friendlyMessage: 'No pudimos abrir el portal de facturación. Intenta de nuevo más tarde.'
    });
  }
}));

/**
 * POST /api/stripe/webhook
 * Webhook de Stripe para eventos de pago
 */
router.post('/webhook', 
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.status(200).json({ received: true });
    }

    console.log(`📥 Webhook recibido: ${event.type}`);

    // Responder inmediatamente
    res.json({ received: true });

    // Procesar en background
    setTimeout(() => {
      processWebhookEvent(event).catch(err => {
        console.error('❌ Error en processWebhookEvent:', err);
      });
    }, 100);
  })
);

/**
 * Procesar evento de webhook y actualizar DB
 */
async function processWebhookEvent(event) {
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      default:
        console.log(`⚠️ Evento no manejado: ${event.type}`);
    }
  } catch (error) {
    console.error('❌ Error processing webhook event:', error);
  }
}

/**
 * Manejar checkout completado - ACTUALIZACIÓN AUTOMÁTICA GARANTIZADA
 */
async function handleCheckoutCompleted(session) {
  const { metadata, customer, subscription } = session;
  const userId = metadata?.userId;
  const plan = metadata?.plan;
  const appsAllowed = parseInt(metadata?.appsAllowed || '0');
  const tokenLimit = parseInt(metadata?.tokenLimit || '0');
  const domainsAllowed = parseInt(metadata?.domainsAllowed || '0');
  const isUpgrade = metadata?.isUpgrade === 'true';

  if (!userId || !plan || !subscription) {
    console.error('❌ Faltan datos requeridos en el checkout');
    return;
  }

  console.log(`🎯 Procesando checkout para usuario ${userId}, plan: ${plan}${isUpgrade ? ' (UPGRADE)' : ''}`);
  console.log('📌 subscription ID de Stripe:', subscription);
  console.log('📌 customer ID de Stripe:', customer);
  console.log('📌 metadata completo:', metadata);

  try {
    await transaction(async (client) => {
      // ===== 1. BUSCAR POR STRIPE_SUBSCRIPTION_ID =====
      const existingByStripeId = await client.query(
        `SELECT id, apps_created, tokens_used, domains_used 
         FROM subscriptions 
         WHERE stripe_subscription_id = $1`,
        [subscription]
      );

      console.log('🔍 Búsqueda por stripe_subscription_id:', existingByStripeId.rows);

      // ===== 2. BUSCAR POR USER_ID COMO RESPALDO =====
      const existingByUserId = await client.query(
        `SELECT id, apps_created, tokens_used, domains_used, plan, status
         FROM subscriptions 
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );

      console.log('🔍 Búsqueda por user_id (activa):', existingByUserId.rows);

      // ===== 3. DECIDIR QUÉ REGISTRO USAR Y CONTADORES =====
      let existingRow = null;
      let appsCreated = 0;
      let tokensUsed = 0;
      let domainsUsed = 0;

      if (existingByStripeId.rows.length > 0) {
        // Ya existe con este stripe_subscription_id
        existingRow = existingByStripeId.rows[0];
        appsCreated = existingRow.apps_created;
        tokensUsed = existingRow.tokens_used;
        domainsUsed = existingRow.domains_used;
        console.log('✅ Usando registro existente por stripe_subscription_id');
      } 
      else if (existingByUserId.rows.length > 0) {
        // Tiene otra suscripción activa (probablemente de otro plan)
        existingRow = existingByUserId.rows[0];
        appsCreated = existingRow.apps_created;
        tokensUsed = existingRow.tokens_used;
        domainsUsed = existingRow.domains_used;
        console.log('✅ Usando registro activo por user_id');
        
        // Cancelar la anterior
        await client.query(
          `UPDATE subscriptions 
           SET status = 'canceled', updated_at = NOW()
           WHERE id = $1`,
          [existingRow.id]
        );
        console.log('✅ Suscripción anterior cancelada');
      }
      else {
        console.log('🆕 No hay suscripción previa, creando nueva con contadores en cero');
      }

      // ===== 4. CREAR O ACTUALIZAR LA NUEVA SUSCRIPCIÓN =====
      if (existingByStripeId.rows.length > 0) {
        // Actualizar la existente
        await client.query(
          `UPDATE subscriptions 
           SET status = 'active', 
               plan = $1, 
               apps_allowed = $2, 
               token_limit = $3,
               domains_allowed = $4, 
               apps_created = $5,
               tokens_used = $6,
               domains_used = $7,
               stripe_customer_id = $8,
               updated_at = NOW()
           WHERE stripe_subscription_id = $9`,
          [plan, appsAllowed, tokenLimit, domainsAllowed, appsCreated, tokensUsed, domainsUsed, customer, subscription]
        );
        console.log('✅ Suscripción existente ACTUALIZADA');
      } 
      else {
        // Crear nueva
        await client.query(
          `INSERT INTO subscriptions (
            user_id, stripe_customer_id, stripe_subscription_id, plan, status,
            apps_allowed, token_limit, tokens_used, apps_created,
            domains_allowed, domains_used
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            userId,
            customer,
            subscription,
            plan,
            'active',
            appsAllowed,
            tokenLimit,
            tokensUsed,
            appsCreated,
            domainsAllowed,
            domainsUsed
          ]
        );
        console.log('✅ Nueva suscripción CREADA');
      }

      // ===== 5. ACTUALIZAR PLAN EN TABLA USERS SIEMPRE =====
      await client.query(
        `UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2`,
        [plan, userId]
      );
      console.log('✅ Plan actualizado en tabla users');

      // ===== 6. REGISTRAR LOG =====
      await client.query(
        `INSERT INTO logs (user_id, log_type, message, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          userId,
          'info',
          isUpgrade ? `Usuario actualizó al plan ${plan}` : `Usuario suscrito al plan ${plan}`,
          JSON.stringify({ 
            plan, 
            appsAllowed, 
            tokenLimit, 
            domainsAllowed,
            isUpgrade,
            previousApps: appsCreated,
            previousTokens: tokensUsed,
            stripeSubscriptionId: subscription 
          })
        ]
      );

      console.log(`✅✅✅ SUSCRIPCIÓN ${isUpgrade ? 'ACTUALIZADA' : 'ACTIVADA'} para usuario ${userId}: ${plan}`);
      console.log(`📊 Nuevos límites: ${appsAllowed} apps, ${tokenLimit} tokens, ${domainsAllowed} dominios`);
    });
  } catch (error) {
    console.error('❌❌❌ ERROR CRÍTICO en handleCheckoutCompleted:', error);
  }
}

/**
 * Manejar actualización de suscripción
 */
async function handleSubscriptionUpdated(subscription) {
  const { id, status, metadata, cancel_at_period_end } = subscription;
  const userId = metadata?.userId;

  try {
    const result = await query(
      `UPDATE subscriptions 
       SET status = $1, updated_at = NOW(), cancel_at_period_end = $2
       WHERE stripe_subscription_id = $3
       RETURNING *`,
      [status, cancel_at_period_end || false, id]
    );
    
    if (result.rows.length > 0) {
      console.log(`✅ Suscripción actualizada en DB: ${id} - ${status}`);
    } else {
      console.log(`⚠️ No se encontró suscripción en DB con ID: ${id}`);
    }
  } catch (error) {
    console.error('❌ Error updating subscription in DB:', error);
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * 🚫 SUSPENSIÓN AUTOMÁTICA - Eliminación de suscripción
 * ═══════════════════════════════════════════════════════════════════
 */
async function handleSubscriptionDeleted(subscription) {
  const { id, metadata } = subscription;
  const userId = metadata?.userId;

  try {
    await transaction(async (client) => {
      const result = await client.query(
        `UPDATE subscriptions 
         SET status = 'canceled', updated_at = NOW()
         WHERE stripe_subscription_id = $1
         RETURNING *`,
        [id]
      );

      if (result.rows.length > 0) {
        console.log(`✅ Suscripción cancelada en DB: ${id}`);
      } else {
        console.log(`⚠️ No se encontró suscripción en DB con ID: ${id}`);
      }

      if (userId) {
        await client.query(
          `UPDATE users SET plan = 'free_trial', updated_at = NOW() WHERE id = $1`,
          [userId]
        );
        console.log(`✅ Usuario ${userId} revertido a free_trial`);

        // 🚫 SUSPENDER TODAS LAS APPS DEL USUARIO
        console.log(`🚫 [STRIPE] Suspendiendo apps por cancelación - Usuario: ${userId}`);
        
        const appsResult = await client.query(
          `SELECT id FROM apps WHERE user_id = $1 AND deployed = TRUE`,
          [userId]
        );

        for (const app of appsResult.rows) {
          console.log(`  🚫 Suspendiendo app ${app.id}`);
          try {
            await deploymentService.suspendApp(
              app.id, 
              userId, 
              'Subscription canceled'
            );
          } catch (suspendError) {
            console.error(`  ❌ Error suspendiendo app ${app.id}:`, suspendError);
          }
        }

        await client.query(
          `INSERT INTO logs (user_id, log_type, message, metadata)
           VALUES ($1, $2, $3, $4)`,
          [
            userId,
            'warning',
            'Suscripción cancelada - Apps suspendidas',
            JSON.stringify({ 
              subscriptionId: id,
              appsSuspended: appsResult.rows.length
            })
          ]
        );
      }
    });
  } catch (error) {
    console.error('❌ Error canceling subscription in DB:', error);
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * ✅ REACTIVACIÓN AUTOMÁTICA - Pago exitoso
 * ═══════════════════════════════════════════════════════════════════
 */
async function handlePaymentSucceeded(invoice) {
  const { id, subscription, total, paid } = invoice;

  try {
    const sub = await stripe.subscriptions.retrieve(subscription);
    const userId = sub.metadata?.userId;

    if (userId) {
      // ✅ REACTIVAR APPS SUSPENDIDAS
      console.log(`✅ [STRIPE] Reactivando apps por pago exitoso - Usuario: ${userId}`);
      
      const appsResult = await query(
        `SELECT id FROM apps 
         WHERE user_id = $1 
         AND deployment_status = 'suspended'`,
        [userId]
      );

      for (const app of appsResult.rows) {
        console.log(`  ✅ Reactivando app ${app.id}`);
        try {
          await deploymentService.reactivateApp(app.id, userId);
        } catch (reactivateError) {
          console.error(`  ❌ Error reactivando app ${app.id}:`, reactivateError);
        }
      }

      await query(
        `INSERT INTO logs (user_id, log_type, message, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          userId,
          'info',
          'Pago procesado - Apps reactivadas',
          JSON.stringify({ 
            invoiceId: id, 
            subscriptionId: subscription, 
            amount: total / 100, 
            paid,
            appsReactivated: appsResult.rows.length
          })
        ]
      );
      console.log(`✅ Pago registrado: ${id} - $${total/100} - ${appsResult.rows.length} apps reactivadas`);
    }
  } catch (error) {
    console.error('❌ Error logging payment success:', error);
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * 🚫 SUSPENSIÓN AUTOMÁTICA - Pago fallido
 * ═══════════════════════════════════════════════════════════════════
 */
async function handlePaymentFailed(invoice) {
  const { id, subscription } = invoice;

  try {
    await query(
      `UPDATE subscriptions 
       SET status = 'past_due', updated_at = NOW()
       WHERE stripe_subscription_id = $1`,
      [subscription]
    );

    const sub = await stripe.subscriptions.retrieve(subscription);
    const userId = sub.metadata?.userId;

    if (userId) {
      // 🚫 SUSPENDER TODAS LAS APPS DEL USUARIO
      console.log(`🚫 [STRIPE] Suspendiendo apps por pago fallido - Usuario: ${userId}`);
      
      const appsResult = await query(
        `SELECT id FROM apps WHERE user_id = $1 AND deployed = TRUE`,
        [userId]
      );

      for (const app of appsResult.rows) {
        console.log(`  🚫 Suspendiendo app ${app.id}`);
        try {
          await deploymentService.suspendApp(
            app.id, 
            userId, 
            'Subscription payment failed'
          );
        } catch (suspendError) {
          console.error(`  ❌ Error suspendiendo app ${app.id}:`, suspendError);
        }
      }

      await query(
        `INSERT INTO logs (user_id, log_type, message, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          userId,
          'error',
          'Pago fallido - Apps suspendidas',
          JSON.stringify({ 
            invoiceId: id, 
            subscriptionId: subscription,
            appsSuspended: appsResult.rows.length
          })
        ]
      );
    }
    console.log(`❌ Pago fallido registrado: ${id} - ${appsResult?.rows.length || 0} apps suspendidas`);
  } catch (error) {
    console.error('❌ Error handling payment failure:', error);
  }
}

/**
 * GET /api/stripe/subscription
 * Obtener suscripción actual del usuario
 */
router.get('/subscription', authenticate, asyncHandler(async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due')
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        success: true, 
        subscription: null,
        message: 'No tienes una suscripción activa'
      });
    }

    res.json({ 
      success: true, 
      subscription: result.rows[0],
      message: 'Suscripción encontrada'
    });
  } catch (error) {
    console.error('❌ Error getting subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener la suscripción',
      friendlyMessage: 'No pudimos verificar tu suscripción. Intenta de nuevo.'
    });
  }
}));

export default router;