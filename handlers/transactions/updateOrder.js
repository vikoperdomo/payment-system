'use strict';
import * as PaymentService from '../../services/payments/PaymentService';
import { v4 as uuidv4 } from 'uuid';

const log = require('lambda-log');

const stage = process.env.STAGE;

export async function handle(event, context, callback) {

    try {

        log.config.meta.stage = process.env.STAGE;
        log.config.meta.source_name = context.functionName;
        log.config.meta.awsRequestId = context.awsRequestId;
        log.config.meta.lambdaEvent = event;
        log.config.debug = true;


        // Catching calls without body, warm up etc, no logs because is known
        if (!event || !event.body) {
            let msg = 'Unable to process this event without a body';
            log.error(msg);
            return failure(msg);
        }

        let timestamp = Date.now();
        let body = JSON.parse(event.body);
        let checkout = body.checkout;

        checkout = checkout.checkout || checkout;

        let payment = body.payment;
        let paymentOrderId = payment.id;
        let shopify_domain = event.pathParameters.shop;
        let paymentMethod = body.paymentMethod;
        let marketplace = body.marketplace;

        // In case that the payment_token is not here we should do initialization of the token
        let payment_token = payment.payment_token || uuidv4();

        let checkout_token = checkout.token;
        let gu_transaction_id = body.gu_transaction_id || event.pathParameters.transactionId;


        const shopify_app_keys = await dynamoDbLib.getShopifyAppKeys(shopify_domain);
        if (shopify_app_keys == null) {
            let message = 'Unable to retrieve shopify_app_keys';
            log.error({}, { msg: message });
            return failure({ code: (500), message });
        }

        // Getting current transaction object
        let transaction = await TransactionService.get(gu_transaction_id);

        if (!transaction) {
            let msg = 'Unable to retrieve transaction';
            log.error(msg, { gu_transaction_id });
            return failure(msg);
        }

        const config = await dynamoDbLib.getShopConfig(shopify_domain);
        if (config == null) {
            let msg = 'Unable to retrieve shop config';
            log.error(msg, { shopify_domain });
            return failure(msg);
        }

        config.brand_email = config.brand_email || shopify_app_keys.brand_email || shopify_app_keys.brandemail;

        const PaymentGatewayService = PaymentService.getCurrentPaymentGateway(paymentMethod);
        let updateResult = await PaymentGatewayService.orderUpdate(body, paymentOrderId, shopify_domain, checkout, config, gu_transaction_id);

        if (updateResult && !updateResult.error && updateResult.statusCode === 200) {
            updateResult.shop = shopify_domain;
            updateResult.shopify_domain = shopify_domain;
            updateResult.checkout_token = checkout_token;
            updateResult.payment_token = payment_token;

            if (updateResult.body) {
                updateResult = JSON.parse(updateResult.body);
            }

            const email = checkout.email || body.email || transaction.email;

            transaction.payment = updateResult;
            if (paymentMethod !== 'shopify') {

                const newCheckout = await ShopifyService.updateCheckout(shopify_domain, body, checkout_token, config.shopify_token);
                transaction.checkout = newCheckout.checkout || newCheckout;

                // Adding the original email back to the checkout
                transaction.checkout.email = email;
            } else {
                transaction.checkout = checkout;
            }


            if (email) {
                transaction.email = email;

                let customertData = {
                    email: email,
                    name: checkout.name,
                    shopify_customer_id: checkout.customer_id,
                    customer_locale: checkout.customer_locale,
                    phone: checkout.phone
                };

                const customer = await CustomerService.upsert(customertData);

                if (customer) {
                    transaction.gu_customer_id = customer.gu_customer_id;
                }
            }

            // Saving Transaction Object with Payment and checkout
            transaction.transaction_status = TransactionStatus.Updated;
            transaction.updated_at = checkout.updated_at;

            transaction = await TransactionService.put(transaction);

            let message = `Update an authorized amount has been successfully processed by ${paymentMethod}`;

            const response = {
                code: (200),
                gu_transaction_id,
                message,
                shop: shopify_domain,
                shopify_domain,
                checkout: {
                    checkout: transaction.checkout
                },
                checkout_token,
                payment_token,
                paymentMethod,
                payment: updateResult,
                order: transaction.order,
                transaction_status: transaction.transaction_status
            };

            return success(response);
        }
    } catch (err) {
        let message = '⚠️ Adjust authorization failure';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
}
