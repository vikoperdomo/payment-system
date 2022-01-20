'use strict';
import * as PaymentService from '../../services/payments/PaymentService';

const log = require('lambda-log');
import { v4 as uuidv4 } from 'uuid';
const source_type = 'Lambda';
const source_invocation = 'Http';
const source_name = 'Create Payment';
const source_method = 'POST';
const version = 2.0;

export async function handle(event, context, callback) {

    try {

        // Catching calls without body, warm up etc, no logs because is known
        if (!event || !event.body) {
            let message = 'Unable to process this event without a body';
            log.error(message);
            return failure(message);
        }

        let body = JSON.parse(event.body);
        let timestamp = Date.now();
        let shopify_domain = event.pathParameters.shop;
        let checkout = body.checkout;
        let gu_transaction_id = body.gu_transaction_id || event.pathParameters.transactionId;
        let paymentMethod = body.paymentMethod;
        // let marketplace = body.marketplace;

        let payment_token = uuidv4();
        let checkout_token = checkout && checkout.token ? checkout.token : null;
        log.config.meta.stage = process.env.STAGE;
        log.config.meta.version = version;
        log.config.meta.source_type = source_type;
        log.config.meta.source_invocation = source_invocation;
        log.config.meta.source_name = source_name;
        log.config.meta.shopify_domain = shopify_domain;
        log.config.meta.checkout_token = checkout_token;
        log.config.meta.payment_token = payment_token;

        log.config.meta.http_request = {
            parameters: {
                shop: shopify_domain,
                shopify_domain,
                checkout_token: checkout_token
            }
        };

        log.config.debug = true;

        const config = await dynamoDbLib.getShopConfig(shopify_domain);

        if (config == null) {
            let message = 'Unable to retrieve shop config';
            log.error({}, { msg: message });
            return failure(message);
        }

        // Creating order using the paymentMethod service
        const PaymentGatewayService = PaymentService.getCurrentPaymentGateway(paymentMethod);
        let createResult = await PaymentGatewayService.createOrder(body, shopify_domain, checkout, config);

        if (createResult && !createResult.error && createResult.statusCode === 200) {

            createResult.shop = shopify_domain;
            createResult.shopify_domain = shopify_domain;
            createResult.payment_token = payment_token;

            // Getting current transaction object
            let transaction = await TransactionService.get(gu_transaction_id);
            let transaction_created = TransactionStatus.Created;

            if (createResult.body) {
                createResult = JSON.parse(createResult.body);
            }

            if (paymentMethod === 'shopify') {
                checkout = createResult;
                checkout_token = checkout.token;
                transaction.checkout = createResult;
            }

            let shopifydomain_checkout_token = `${shopify_domain}_${checkout.token}`;
            let shopifydomain_orderid = `${shopify_domain}_null`;

            if (!transaction) {
                // We will create transaction object if not exist already
                transaction = {
                    gu_transaction_id,
                    shopifydomain_checkout_token,
                    shopifydomain_orderid,
                    payment_token,
                    shopify_domain,
                    payment_gateway: paymentMethod,
                    checkout,
                    transaction_status: transaction_created,
                    payment: createResult,
                    order: null,
                    refund: null,
                    created_at: timestamp
                };

                if (checkout.email) {
                    transaction.email = checkout.email;
                }

                if (checkout.name) {
                    transaction.order_name = checkout.name;
                }
            }

            // Saving Transaction Object with Checkout
            transaction.transaction_status = transaction_created;
            transaction = await TransactionService.put(transaction);

            let message = `Payment Order Created Successfully by ${paymentMethod}`;

            const response = {
                code: (200),
                gu_transaction_id,
                message,
                shop: shopify_domain,
                shopify_domain,
                checkout: {
                    checkout
                },
                checkout_token,
                payment_token,
                paymentMethod,
                payment: createResult,
                shopifydomain_checkout_token,
                transaction_status: transaction.transaction_status
            };

            return success(response);
        }
    } catch (err) {
        let message = '⚠️ Order Creation failure';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
}
