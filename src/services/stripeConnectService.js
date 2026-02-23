/**
 * Stripe Connect Service
 * Maneja cuentas Connect de usuarios y creación automática de productos
 */

import Stripe from 'stripe';
import { query } from '../config/database.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

class StripeConnectService {

  /**
   * Crear cuenta Connect Express para un usuario nuevo
   */
  async createConnectAccount(userId, userEmail) {
    try {
      // Verificar si ya tiene cuenta
      const existing = await query(
        'SELECT stripe_account_id FROM users WHERE id = $1',
        [userId]
      );

      if (existing.rows[0]?.stripe_account_id) {
        return {
          success: true,
          accountId: existing.rows[0].stripe_account_id,
          alreadyExists: true
        };
      }

      // Crear cuenta Express en Stripe
      const account = await stripe.accounts.create({
        type: 'express',
        email: userEmail,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        metadata: { userId }
      });

      // Guardar en DB
      await query(
        `INSERT INTO stripe_connect_accounts 
         (user_id, stripe_account_id, status, account_type)
         VALUES ($1, $2, 'pending', 'express')`,
        [userId, account.id]
      );

      await query(
        `UPDATE users SET 
         stripe_account_id = $1,
         stripe_account_status = 'pending'
         WHERE id = $2`,
        [account.id, userId]
      );

      console.log(`✅ Cuenta Connect creada: ${account.id} para usuario ${userId}`);

      return { success: true, accountId: account.id };

    } catch (error) {
      console.error('❌ Error creando cuenta Connect:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generar URL de onboarding para que el usuario conecte su cuenta
   */
  async createOnboardingLink(userId) {
    try {
      const result = await query(
        'SELECT stripe_account_id FROM users WHERE id = $1',
        [userId]
      );

      if (!result.rows[0]?.stripe_account_id) {
        throw new Error('Usuario no tiene cuenta Connect');
      }

      const accountId = result.rows[0].stripe_account_id;

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${process.env.FRONTEND_URL}/dashboard?stripe=refresh`,
        return_url: `${process.env.FRONTEND_URL}/dashboard?stripe=success`,
        type: 'account_onboarding'
      });

      // Guardar URL en DB
      await query(
        `UPDATE stripe_connect_accounts 
         SET onboarding_url = $1, updated_at = NOW()
         WHERE stripe_account_id = $2`,
        [accountLink.url, accountId]
      );

      return { success: true, url: accountLink.url };

    } catch (error) {
      console.error('❌ Error creando onboarding link:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verificar estado de la cuenta Connect del usuario
   */
  async getAccountStatus(userId) {
    try {
      const result = await query(
        `SELECT stripe_account_id, stripe_account_status, 
                stripe_charges_enabled, stripe_onboarding_completed
         FROM users WHERE id = $1`,
        [userId]
      );

      if (!result.rows[0]?.stripe_account_id) {
        return { connected: false, status: 'not_connected' };
      }

      const accountId = result.rows[0].stripe_account_id;

      // Verificar estado actual en Stripe
      const account = await stripe.accounts.retrieve(accountId);

      const chargesEnabled = account.charges_enabled;
      const payoutsEnabled = account.payouts_enabled;
      const detailsSubmitted = account.details_submitted;

      // Actualizar DB con estado actual
      await query(
        `UPDATE users SET
         stripe_charges_enabled = $1,
         stripe_payouts_enabled = $2,
         stripe_onboarding_completed = $3,
         stripe_account_status = $4
         WHERE id = $5`,
        [
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
          chargesEnabled ? 'active' : 'pending',
          userId
        ]
      );

      await query(
        `UPDATE stripe_connect_accounts SET
         charges_enabled = $1,
         payouts_enabled = $2,
         details_submitted = $3,
         status = $4,
         updated_at = NOW()
         WHERE stripe_account_id = $5`,
        [
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
          chargesEnabled ? 'active' : 'pending',
          accountId
        ]
      );

      return {
        connected: true,
        accountId,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        status: chargesEnabled ? 'active' : 'pending'
      };

    } catch (error) {
      console.error('❌ Error verificando estado:', error);
      return { connected: false, error: error.message };
    }
  }

  /**
   * Crear productos y precios automáticamente en la cuenta del usuario
   * @param {string} stripeAccountId - cuenta Connect del usuario
   * @param {Array} products - [{ name, price, currency, description }]
   */
  async createProductsForUser(stripeAccountId, products) {
    const created = [];

    for (const product of products) {
      try {
        // Crear producto en la cuenta del usuario
        const stripeProduct = await stripe.products.create(
          {
            name: product.name,
            description: product.description || product.name,
            metadata: { platform: 'AutoAppOrchestrator' }
          },
          { stripeAccount: stripeAccountId }
        );

        // Crear precio para el producto
        const stripePrice = await stripe.prices.create(
          {
            product: stripeProduct.id,
            unit_amount: Math.round(product.price * 100), // centavos
            currency: product.currency || 'usd',
            metadata: { platform: 'AutoAppOrchestrator' }
          },
          { stripeAccount: stripeAccountId }
        );

        created.push({
          name: product.name,
          price: product.price,
          currency: product.currency || 'usd',
          product_id: stripeProduct.id,
          price_id: stripePrice.id
        });

        console.log(`✅ Producto creado: ${product.name} - $${product.price} (${stripePrice.id})`);

      } catch (error) {
        console.error(`❌ Error creando producto ${product.name}:`, error.message);
      }
    }

    return created;
  }

  /**
   * Crear checkout session en la cuenta del usuario (dinero va a él)
   * Tu plataforma cobra application_fee automáticamente
   */
  async createCheckoutForUserApp(stripeAccountId, priceId, successUrl, cancelUrl) {
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          payment_intent_data: {
            // Tu comisión: 5% automático en cada pago
            application_fee_amount: null // se calcula por precio
          }
        },
        { stripeAccount: stripeAccountId }
      );

      return { success: true, url: session.url, sessionId: session.id };

    } catch (error) {
      console.error('❌ Error creando checkout:', error);
      return { success: false, error: error.message };
    }
  }
}

export const stripeConnectService = new StripeConnectService();
export default stripeConnectService;