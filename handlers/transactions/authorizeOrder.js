'use strict';

import * as PaymentService from '../../services/payments/PaymentService';

const log = require('lambda-log');
 const source_type = 'Lambda';
const source_invocation = 'Http';
const source_name = 'Authorize Payment';
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

        let timestamp = Date.now();
        let body = JSON.parse(event.body);
        let shopify_domain = event.pathParameters.shop;
        let checkout = body.checkout;
        let gu_transaction_id = body.gu_transaction_id || event.pathParameters.transactionId;
        let payment = body.payment;
        let paymentOrderId = payment.orderID || payment.id;
        let paymentMethod = body.paymentMethod;
        let payment_token = payment.payment_token;
        let checkout_token = checkout.token;
        /* Payment Info */
        body.payment.ip_address = event.requestContext.identity.sourceIp;
        body.payment.user_agent = event.requestContext.identity.userAgent;

        log.config.meta.stage = process.env.STAGE;
        log.config.meta.version = version;
        log.config.meta.source_type = source_type;
        log.config.meta.source_invocation = source_invocation;
        log.config.meta.source_name = source_name;
        log.config.meta.shopify_domain = shopify_domain;
        log.config.meta.checkout_token = checkout.token;
        log.config.meta.payment_token = payment.payment_token;

        log.config.meta.http_request = {
            parameters: {
            }
        };
        log.config.debug = true;

        // Getting current transaction object
        let transaction = await TransactionService.get(gu_transaction_id);

        if (!transaction) {
            let message = `Unable to retrieve transaction with id ${gu_transaction_id}`;
            log.error({}, { msg: message });
            return failure({ code: (500), message });
        }

        const config = await dynamoDbLib.getShopConfig(shopify_domain);
        if (config == null) {
            let message = 'Unable to retrieve shop config';
            log.error({}, { msg: message });
            return failure({ code: (500), message });
        }

        const PaymentGatewayService = PaymentService.getCurrentPaymentGateway(paymentMethod);
        let authorizeResult = await PaymentGatewayService.authorizeOrder(body, paymentOrderId, shopify_domain, checkout, config);

        if (authorizeResult.body && typeof authorizeResult.body != 'undefined') {
            authorizeResult = JSON.parse(authorizeResult.body);
        }

        if (authorizeResult && !authorizeResult.error && !authorizeResult.errorStack) {

            authorizeResult.shop = shopify_domain;
            authorizeResult.shopify_domain = shopify_domain;
            authorizeResult.checkout_token = checkout_token;
            authorizeResult.payment_token = payment_token;

            transaction.payment = authorizeResult;
            transaction.transaction_status = TransactionStatus.Authorized;
            transaction.updated_at = checkout.updated_at;

            // Saving Transaction Object with Payment and checkout
            transaction = await TransactionService.put(transaction);

            if (authorizeResult.body) {
                authorizeResult = JSON.parse(authorizeResult.body);
            }

            let message = `Payment Order authorization by ${paymentMethod} is successful`;

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
                payment: authorizeResult,
                transaction_status: transaction.transaction_status,
                order: transaction.order
            };

            return success(response);
        }
    } catch (err) {
        let message = '⚠️ Payment authorization failure';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
}
