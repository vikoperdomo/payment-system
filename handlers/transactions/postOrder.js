'use strict';

import * as PaymentService from '../../services/payments/PaymentService';

const log = require('lambda-log');

const stage = process.env.STAGE;

export async function handle(event, context, callback) {
    try {
        // Catching calls without body, warm up etc, no logs because is known
        if (!event || !event.body) {
            let msg = 'Unable to process this event without a body';
            log.error(msg);
            return failure(msg);
        }
        let timestamp = Date.now();

        log.config.meta.stage = stage;
        log.config.meta.time = timestamp;
        log.config.meta.source_name = context.functionName;
        log.config.meta.awsRequestId = context.awsRequestId;
        log.config.debug = true;

        log.config.meta.lambdaEvent = event;

        let body = JSON.parse(event.body);
        let shopify_domain = event.pathParameters.shop;
        let checkout = body.checkout;
        checkout = checkout.checkout || checkout;
        let payment = body.payment;
        let gu_transaction_id = body.gu_transaction_id || event.pathParameters.transactionId;
        let browser_ip = event.requestContext.identity.sourceIp;
        let landing_site = checkout.note_attributes.landing_site;
        let user_agent = event.requestContext.identity.userAgent;

        /* Payment Info */
        body.payment.ip_address = browser_ip;
        body.payment.browser_ip = browser_ip;
        body.payment.landing_site = landing_site;
        body.payment.user_agent = user_agent;

        /* Extra Info */
        body.browser_ip = browser_ip;
        body.landing_site = landing_site;
        body.user_agent = user_agent;

        let paymentOrderId = payment.id;
        let payment_token = payment.payment_token;
        let paymentMethod = body.paymentMethod;
        let checkout_token = checkout && checkout.token ? checkout.token : null;


        const shopify_app_keys = await dynamoDbLib.getShopifyAppKeys(shopify_domain);
        if (shopify_app_keys == null) {
            let message = 'Unable to retrieve shopify_app_keys';
            log.error({}, { msg: message });
            return failure({ code: (500), message });
        }

        // Getting current transaction object
        let transaction = await TransactionService.get(gu_transaction_id);

        if (!transaction) {
            let msg = `Unable to retrieve transaction with id ${gu_transaction_id}`;
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

        body.transaction = transaction;

        const PaymentGatewayService = PaymentService.getCurrentPaymentGateway(paymentMethod);

        let postResult = await PaymentGatewayService.postOrder(body, shopify_domain, checkout, config, paymentOrderId);

        if (postResult && postResult.body && typeof postResult.body != 'undefined') {
            postResult = JSON.parse(postResult.body);
        }

        if (postResult && !postResult.error && !postResult.errorStack) {

            if (!checkout.shipping_address && postResult.shipping_address) {
                checkout.shipping_address = postResult.shipping_address;
            }

            if (!checkout.billing_address && postResult.billing_address) {
                checkout.billing_address = postResult.billing_address;
            }

            // Updating or creating shopify order
            let shopifyOrder;

            if (paymentMethod !== 'shopify') {

                // Adding shipping lines to the order
                if (!checkout.shipping_lines && checkout.shipping_line) {
                    checkout.shipping_lines = [checkout.shipping_line];
                }

                // Adding transaction to the order
                if (!checkout.transactions) {
                    checkout.transactions = [{
                        amount: checkout.total_price,
                        currency: checkout.currency,
                        gateway: paymentMethod,
                        status: 'success',
                        kind: 'capture'
                    }];
                }

                // browser_ip and landing_site
                checkout.browser_ip = browser_ip;
                checkout.landing_site = landing_site;
                checkout.user_agent = user_agent;

                checkout.email = checkout.email || transaction.email;

                let order = ShopifyService.createOrderData(checkout);

                shopifyOrder = await ShopifyService.postOrder(shopify_domain, order, config.shopify_token);
                shopifyOrder = shopifyOrder.order;
            } else {
                shopifyOrder = postResult;
            }

            let orderId = shopifyOrder ? shopifyOrder.id : null;

            transaction.payment = postResult;
            transaction.order = shopifyOrder;

            // Saving tax_lines in the order from the checkout if is missing
            if (checkout.tax_lines && !transaction.order.tax_lines || transaction.order.tax_lines.length === 0) {
                transaction.order.tax_lines = checkout.tax_lines;
            }

            transaction.order.orderId = orderId;
            transaction.order_id = orderId;
            transaction.transaction = shopifyOrder.transaction && shopifyOrder.transaction.transaction ? shopifyOrder.transaction.transaction : shopifyOrder.transaction;
            transaction.payment_gateway = paymentMethod;
            transaction.checkout = checkout;
            transaction.transaction_status = TransactionStatus.Completed;

            if (shopifyOrder.email || transaction.email || transaction.checkout.email) {
                transaction.email = shopifyOrder.email || transaction.email || transaction.checkout.email;
            }

            if (shopifyOrder.name || transaction.order_name || transaction.checkout.name) {
                transaction.order_name = shopifyOrder.name || transaction.order_name || transaction.checkout.name;
            }

            let shopifydomain_orderid = shopify_domain + '_' + orderId;

            transaction.shopifydomain_orderid = shopifydomain_orderid;
            transaction.updated_at = checkout.updated_at;

            let message = `Order Completed Successfully by ${paymentMethod}`;

            let customertData = {
                email: checkout.email,
                name: checkout.name,
                shopify_customer_id: checkout.customer_id,
                customer_locale: checkout.customer_locale,
                phone: checkout.phone
            };

            const customer = await CustomerService.upsert(customertData);

            if (customer) {
                transaction.gu_customer_id = customer.gu_customer_id;
            }

            // Saving Transaction Object with Payment, Order and checkout
            transaction = await TransactionService.put(transaction);

            if (process.env.ACTIVE_CAMPAIGN_ABANDONED_CART == 'true') {
                // Send the customer and the checkout to the Active Campaign Queue to Upsert the Order
                await sqsAdapter.sendActiveCampaignMessage(shopify_domain, gu_transaction_id, customer, checkout, ActiveCampaign.Order);
            }

            const response = {
                code: (200),
                shopifydomain_orderid,
                gu_transaction_id,
                order_id: orderId,
                message,
                shop: shopify_domain,
                shopify_domain,
                checkout: {
                    checkout: transaction.checkout
                },
                checkout_token,
                payment_token,
                paymentMethod,
                payment: postResult,
                order: transaction.order,
                transaction_status: transaction.transaction_status
            };

            return success(response);
        }
    } catch (err) {
        let message = '⚠️ Failed shopify create order';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
}
