/**
 * Servicio de integración con Stripe
 * Maneja suscripciones, pagos y webhooks
 */

import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

// Inicializar Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

/**
 * Crear sesión de checkout para suscripción
 * @param {string} userId - ID del usuario
 * @param {string} priceId - ID del precio de Stripe
 * @param {string} email - Email del usuario
 * @param {Object} metadata - Metadatos adicionales (appsAllowed, tokenLimit, plan)
 * @returns {Promise<Object>} - Sesión de checkout
 */
export const createCheckoutSession = async (userId, priceId, email, metadata = {}) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.CORS_ORIGIN}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CORS_ORIGIN}/pricing?canceled=true`,
      customer_email: email,
      metadata: {
        userId,
        plan: metadata.plan || 'basico',
        appsAllowed: metadata.appsAllowed?.toString() || '3',
        tokenLimit: metadata.tokenLimit?.toString() || '50000',
        ...metadata
      },
      subscription_data: {
        metadata: {
          userId,
          plan: metadata.plan || 'basico',
          appsAllowed: metadata.appsAllowed?.toString() || '3',
          tokenLimit: metadata.tokenLimit?.toString() || '50000',
        },
      },
    });

    return {
      success: true,
      sessionId: session.id,
      url: session.url,
    };
  } catch (error) {
    console.error('❌ Error creating Stripe checkout session:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Crear portal de cliente para gestionar suscripción
 * @param {string} customerId - ID del cliente en Stripe
 * @returns {Promise<Object>} - URL del portal
 */
export const createCustomerPortal = async (customerId) => {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.CORS_ORIGIN}/dashboard`,
    });

    return {
      success: true,
      url: session.url,
    };
  } catch (error) {
    console.error('❌ Error creating customer portal:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Obtener detalles de suscripción
 * @param {string} subscriptionId - ID de la suscripción
 * @returns {Promise<Object>} - Detalles de la suscripción
 */
export const getSubscription = async (subscriptionId) => {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        priceId: subscription.items.data[0].price.id,
        plan: subscription.metadata?.plan || 'basico',
        userId: subscription.metadata?.userId,
      },
    };
  } catch (error) {
    console.error('❌ Error getting subscription:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Cancelar suscripción (al final del período)
 * @param {string} subscriptionId - ID de la suscripción
 * @returns {Promise<Object>} - Resultado
 */
export const cancelSubscription = async (subscriptionId) => {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    return {
      success: true,
      subscription: {
        id: subscription.id,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      },
    };
  } catch (error) {
    console.error('❌ Error canceling subscription:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Cancelar suscripción inmediatamente
 * @param {string} subscriptionId - ID de la suscripción
 * @returns {Promise<Object>} - Resultado
 */
export const cancelSubscriptionImmediately = async (subscriptionId) => {
  try {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
      },
    };
  } catch (error) {
    console.error('❌ Error canceling subscription immediately:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Reactivar suscripción cancelada
 * @param {string} subscriptionId - ID de la suscripción
 * @returns {Promise<Object>} - Resultado
 */
export const reactivateSubscription = async (subscriptionId) => {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });

    return {
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    };
  } catch (error) {
    console.error('❌ Error reactivating subscription:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Cambiar plan de suscripción
 * @param {string} subscriptionId - ID de la suscripción
 * @param {string} newPriceId - ID del nuevo precio
 * @returns {Promise<Object>} - Resultado
 */
export const updateSubscriptionPlan = async (subscriptionId, newPriceId) => {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const subscriptionItemId = subscription.items.data[0].id;

    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscriptionItemId,
          price: newPriceId,
        },
      ],
      proration_behavior: 'create_prorations',
    });

    return {
      success: true,
      subscription: {
        id: updatedSubscription.id,
        status: updatedSubscription.status,
        priceId: updatedSubscription.items.data[0].price.id,
        currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000),
      },
    };
  } catch (error) {
    console.error('❌ Error updating subscription plan:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Procesar evento de webhook de Stripe
 * @param {Object} event - Evento de Stripe
 * @returns {Promise<Object>} - Resultado del procesamiento
 */
export const handleWebhookEvent = async (event) => {
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        return await handleCheckoutCompleted(event.data.object);
      
      case 'customer.subscription.updated':
        return await handleSubscriptionUpdated(event.data.object);
      
      case 'customer.subscription.deleted':
        return await handleSubscriptionDeleted(event.data.object);
      
      case 'invoice.payment_succeeded':
        return await handlePaymentSucceeded(event.data.object);
      
      case 'invoice.payment_failed':
        return await handlePaymentFailed(event.data.object);
      
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
        return { success: true, handled: false, eventType: event.type };
    }
  } catch (error) {
    console.error('❌ Error handling webhook event:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Manejar checkout completado
 * @private
 */
async function handleCheckoutCompleted(session) {
  console.log('✅ Checkout completed:', session.id);
  
  return {
    success: true,
    eventType: 'checkout.session.completed',
    data: {
      sessionId: session.id,
      customerId: session.customer,
      subscriptionId: session.subscription,
      userId: session.metadata?.userId,
      plan: session.metadata?.plan || 'basico',
      appsAllowed: parseInt(session.metadata?.appsAllowed || '3'),
      tokenLimit: parseInt(session.metadata?.tokenLimit || '50000'),
    },
  };
}

/**
 * Manejar actualización de suscripción
 * @private
 */
async function handleSubscriptionUpdated(subscription) {
  console.log('🔄 Subscription updated:', subscription.id);
  
  return {
    success: true,
    eventType: 'customer.subscription.updated',
    data: {
      subscriptionId: subscription.id,
      status: subscription.status,
      customerId: subscription.customer,
      userId: subscription.metadata?.userId,
      plan: subscription.metadata?.plan,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  };
}

/**
 * Manejar eliminación de suscripción
 * @private
 */
async function handleSubscriptionDeleted(subscription) {
  console.log('❌ Subscription deleted:', subscription.id);
  
  return {
    success: true,
    eventType: 'customer.subscription.deleted',
    data: {
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      userId: subscription.metadata?.userId,
      plan: subscription.metadata?.plan,
    },
  };
}

/**
 * Manejar pago exitoso
 * @private
 */
async function handlePaymentSucceeded(invoice) {
  console.log('✅ Payment succeeded:', invoice.id);
  
  return {
    success: true,
    eventType: 'invoice.payment_succeeded',
    data: {
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
      customerId: invoice.customer,
      amount: invoice.amount_paid / 100, // Convertir de centavos a dólares
      currency: invoice.currency,
      paid: invoice.paid,
    },
  };
}

/**
 * Manejar pago fallido
 * @private
 */
async function handlePaymentFailed(invoice) {
  console.log('❌ Payment failed:', invoice.id);
  
  return {
    success: true,
    eventType: 'invoice.payment_failed',
    data: {
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
      customerId: invoice.customer,
      amount: invoice.amount_due / 100,
      currency: invoice.currency,
      nextPaymentAttempt: invoice.next_payment_attempt 
        ? new Date(invoice.next_payment_attempt * 1000) 
        : null,
    },
  };
}

/**
 * Verificar firma de webhook
 * @param {string} payload - Payload del webhook
 * @param {string} signature - Firma del webhook
 * @returns {Object|null} - Evento verificado o null
 */
export const verifyWebhookSignature = (payload, signature) => {
  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    return event;
  } catch (error) {
    console.error('❌ Webhook signature verification failed:', error);
    return null;
  }
};

/**
 * Obtener planes de precios disponibles
 * @returns {Object} - Planes con sus IDs
 */
export const getPricingPlans = () => {
  return {
    basico: {
      priceId: process.env.STRIPE_PRICE_BASICO,
      name: 'Básico',
      price: 29.99,
      appsAllowed: 3,
      tokenLimit: 50000,
      features: [
        '3 apps desplegadas',
        '50,000 tokens/mes',
        'Deploy automático',
        'Dominio .vercel.app',
        'SSL gratis',
        'Soporte por email'
      ],
    },
    premium: {
      priceId: process.env.STRIPE_PRICE_PREMIUM,
      name: 'Premium',
      price: 49.99,
      appsAllowed: 8,
      tokenLimit: 150000,
      features: [
        '8 apps desplegadas',
        '150,000 tokens/mes',
        'Deploy automático',
        'Dominio .vercel.app',
        'SSL gratis',
        'Backups automáticos',
        'Soporte prioritario'
      ],
    },
    pro: {
      priceId: process.env.STRIPE_PRICE_PRO,
      name: 'Pro',
      price: 99.99,
      appsAllowed: 25,
      tokenLimit: 500000,
      features: [
        '25 apps desplegadas',
        '500,000 tokens/mes',
        'Deploy automático',
        'Dominio .vercel.app',
        'SSL gratis',
        'Backups automáticos',
        'Dominios personalizados',
        'Soporte 24/7',
        'API prioritario'
      ],
    },
  };
};

export default {
  createCheckoutSession,
  createCustomerPortal,
  getSubscription,
  cancelSubscription,
  cancelSubscriptionImmediately,
  reactivateSubscription,
  updateSubscriptionPlan,
  handleWebhookEvent,
  verifyWebhookSignature,
  getPricingPlans,
};