const Shopify = require('shopify-api-node');
const log = require('lambda-log');

export const createOrder = async (body, shopify_domain, checkout, config) => {
    try {

        log.debug('Payment Shopify Order', { checkout: checkout, shopify_domain: shopify_domain, shop_config: config });

        const shopify = new Shopify({
            shopName: shopify_domain,
            accessToken: config.shopify_token
        });

        /* Get line Items to start checkout */
        let checkoutItems = {
            'checkout': {
                'email': checkout.email,
                'line_items': checkout.line_items,
                'shipping_address': checkout.shipping_address,
                'billing_address': checkout.billing_address
            }
        };

        /**
         * Retrieves payment
         * from merchant account
         */
        let paymentResult = await shopify.checkout.create(checkoutItems);

        if (typeof paymentResult != 'undefined' && paymentResult != null) {
            paymentResult.id = paymentResult.token;
            // This file returns a JSON object
            return success(paymentResult);
        } else if (paymentResult && paymentResult.name === 'StatusCodeError' ||
            paymentResult && paymentResult.name === 'Error') {
            let message = `🔔 Shopify Status Code from the 'Payment Process' is ${paymentResult.statusCode} (should be 200)`;
            log.error(message, { paymentResult });
            return failure(message);
        }
    } catch (err) {
        let message = `⚠️ Payment authorization failure Shopify Status Code from the 'Payment Process' is ${err.statusCode} (should be 200)`;
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
};

export const orderUpdate = async (body, orderId, shopify_domain, checkout, config) => {
    try {

        log.debug('Update Shopify Order', { checkout: checkout, shopify_domain: shopify_domain, shop_config: config });

        const shopify = new Shopify({
            shopName: shopify_domain,
            accessToken: config.shopify_token
        });

        // If the payment checkout_token is not defined we will use the checkout.token
        let checkoutToken = body.payment.checkout_token || checkout.token;

        /**
         * Retrieves payment
         * from merchant account
         */
        let paymentResult = await shopify.checkout.update(checkoutToken, { checkout });

        if (typeof paymentResult != 'undefined' && paymentResult != null) {
            paymentResult.id = paymentResult.token;
            // This file returns a JSON object
            return success(paymentResult);
        } else if (paymentResult && paymentResult.name === 'StatusCodeError' ||
            paymentResult && paymentResult.name === 'Error') {
            let message = `🔔 Shopify Status Code from the 'Update Checkout Order' is ${paymentResult.statusCode} (should be 200)`;
            return failure(message);
        }
    } catch (err) {
        let message = 'Shopify Call Fails to update an order';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
};

export const authorizeOrder = async (body, orderId, shopify_domain, checkout, config) => {
    try {

        log.debug('Process Authorize Payment Shopify Order', { checkout: checkout, shopify_domain: shopify_domain, shop_config: config });

        const shopify = new Shopify({
            shopName: shopify_domain,
            accessToken: config.shopify_token
        });

        const unique_token = body.payment.checkout_token;

        let checkoutToken = body.payment.checkout_token;

        let checkoutParams = {
            checkout: {
                email: checkout.email
            }
        };

        // Adding the original email back to the checkout
        let checkoutResult = await shopify.checkout.update(unique_token, checkoutParams);

        if (typeof checkoutResult != 'undefined' && checkoutResult != null) {

        } else {
            if (checkoutResult && checkoutResult.name === 'StatusCodeError' || checkoutResult && checkoutResult.name === 'Error') {
                let message = `🔔 Shopify Status Code from the 'Update Checkout Order' is ${checkoutResult.statusCode} (should be 200)`;
                log.error(message, { checkoutResult });
                return failure(message);
            }
        }

        /* Payment Object*/
        let paymentObject = {
            'request_details': {
                'ip_address': body.payment.ip_address,
                'accept_language': body.payment.accept_language,
                'user_agent': body.payment.user_agent
            },
            'amount': checkout.payment_due,
            'session_id': body.payment.session_id,
            'unique_token': unique_token
        };
        /**
         * Retrieves payment
         * from merchant account
         */
        let paymentResult = await shopify.payment.create(unique_token, paymentObject);

        if (paymentResult && typeof paymentResult != 'undefined' && paymentResult.statusCode >= 200 && paymentResult.statusCode < 304 || paymentResult.fraudulent === false) {
            let paymentId = paymentResult.id;
            let postResult = await shopify.payment.get(unique_token, paymentId);
            // This file returns a JSON object
            return success(postResult);
        } else if (paymentResult && paymentResult.name === 'HTTPError' || paymentResult.statusCode >= 303 || typeof shopify.checkout === 'undefined') {
            let message = `🔔 Shopify Status Code from the 'Authorize Payment 'is ${paymentResult.statusCode} (should be 200)`;
            log.error(message, { paymentResult });
            return failure(message);
        }
    } catch (err) {
        let message = 'Shopify Call Fails to Post Authorize Payment Process';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
};

export const postOrder = async (body, shopify_domain, checkout, config) => {
    try {

        log.debug('Complete Shopify Order', { checkout: checkout, shopify_domain: shopify_domain, shop_config: config });

        const shopify = new Shopify({
            shopName: shopify_domain,
            accessToken: config.shopify_token
        });

        let unique_token = checkout.token;
        // Getting current transaction object
        let transaction = body.transaction.payment;
        /**
         * Retrieves payment
         * from merchant account
         */
        let checkoutResult = await shopify.checkout.get(unique_token);
        let order = checkoutResult && checkoutResult.order ? checkoutResult.order : null;
        let orderID = order && checkoutResult.order.id ? checkoutResult.order.id : null;

        let count = 0;

        while (count < 3 && checkoutResult && typeof checkoutResult !== 'undefined' && (order && typeof order === 'undefined' || order === null)) {

            log.debug('Complete Shopify Order Waiting', { checkoutResult: checkoutResult });

            // wait 3 seconds
            await new Promise(res => setTimeout(res, 3000));

            count++;

            checkoutResult = await shopify.checkout.get(unique_token);
            order = checkoutResult && checkoutResult.order ? checkoutResult.order : null;
            orderID = order && checkoutResult.order.id ? checkoutResult.order.id : null;
        }

        log.debug('Complete Shopify Order', { checkoutResult: checkoutResult });

        if (orderID && typeof orderID !== 'undefined' || orderID !== null) {
            order = await shopify.order.open(orderID);
        }

        if (checkoutResult && typeof checkoutResult !== 'undefined' && typeof order !== 'undefined' && typeof orderID !== 'undefined') {

            let orderResult = await shopify.order.update(orderID, checkout);
            if (order.financial_status === 'paid' || order.confirmed === true) {
                if (!order.payments) {
                    checkout = await shopify.checkout.get(unique_token);
                    orderResult.transaction = checkout.payments[0].transaction;
                }
                // This file returns a JSON object
                return success(orderResult);
            } else {
                orderResult.transaction = await ShopifyService.updateTransaction(shopify_domain, orderID, config.shopify_token);
                orderResult.financial_status = orderResult.transaction.kind;
            }

            // This file returns a JSON object
            return success(orderResult);
        }

        let message = `🔔 Shopify Status Code from the 'Complete Checkout' is ${checkoutResult.statusCode} or is still processing (should be 200)`;
        return failure({ statusCode: (checkoutResult.statusCode || 201), errorStack: { message } });

    } catch (err) {
        let message = 'Shopify Call Fails to Complete Order Process';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
};

export const getOrder = async (body, shopify_domain, checkout, config) => {
    try {

        log.debug('Get Payment Shopify Order', { checkout: checkout, shopify_domain: shopify_domain, shop_config: config });

        const shopify = new Shopify({
            shopName: shopify_domain,
            accessToken: config.shopify_token
        });

        if (!checkout || !checkout.token) {
            let message = '🔔 Missing Shopify Checkout Token';
            return failure(errorCleanUp({}, message));
        }

        let unique_token = checkout.token;
        let orderID = body.order.id && body.order_id ? body.order_id : null;

        /**
         * Retrieves Order
         * from merchant account
         */

        let orderResult;

        if (!orderID) {
            let checkoutResult = await shopify.checkout.get(unique_token);
            orderID = checkoutResult.order.id;
        }

        orderResult = await shopify.order.open(orderID);

        if (typeof orderResult !== 'undefined' && orderResult !== null && orderResult.id !== 'undefined' && orderResult.id !== null) {
            orderResult = await shopify.order.update(orderID, checkout);
            // This file returns a JSON object
            return orderResult;
        } else if (orderResult && orderResult.name === 'StatusCodeError' ||
            orderResult && orderResult.name === 'Error') {
            let message = `🔔 Shopify Status Code from the 'Get Payment Process' is ${orderResult.statusCode} (should be 200)`;
            return failure(message);
        }
    } catch (err) {
        let message = `⚠️ Payment authorization failure Shopify Status Code from the 'Get Payment Process' is ${err.statusCode} (should be 200)`;
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
};

export const refundOrder = async (body, orderId, shopify_domain, payment, checkout, config) => {
    try {

        log.debug('Refund Shopify Order', { checkout: checkout, shopify_domain: shopify_domain, shop_config: config });

        const shopify = new Shopify({
            shopName: shopify_domain,
            accessToken: config.shopify_token
        });

        /* Get line Items to start checkout */
        let refundInfo = checkout.refund;

        /**
         * Retrieves payment
         * from merchant account
         */
        let calculateRefundResult = await shopify.refund.calculate(orderId, refundInfo);

        if (calculateRefundResult && typeof calculateRefundResult != 'undefined' &&
            !calculateRefundResult.error && !calculateRefundResult.errorStack &&
            calculateRefundResult.statusCode >= 200 && calculateRefundResult.statusCode < 304) {

            let refundResult = await shopify.refund.create(orderId, refundInfo);

            if (typeof refundResult != 'undefined' && refundResult != null) {
                // This file returns a JSON object
                return success(refundResult);
            } else if (refundResult && refundResult.name === 'StatusCodeError' ||
                refundResult && refundResult.name === 'Error') {
                let message = `🔔 Shopify Status Code from the 'Payment Process' is ${refundResult.statusCode} (should be 200)`;
                log.error(refundResult, { msg: message });
                return failure(message);
            }
        }
    } catch (err) {
        let message = 'Shopify Call Fails to do the Refund';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
};

export const cancelOrder = async (body, orderId, shopify_domain, checkout, config) => {
    try {

        log.debug('Cancel Shopify Order', { checkout: checkout, shopify_domain: shopify_domain, shop_config: config });

        const shopify = new Shopify({
            shopName: shopify_domain,
            accessToken: config.shopify_token
        });

        /* Get cancel info from the checkout */
        let cancelInfo = checkout.cancel;

        /**
         * Cancel Order
         */
        let cancelOrderResult = await shopify.order.cancel(orderId, cancelInfo);

        if (cancelOrderResult && typeof cancelOrderResult != 'undefined' &&
            !cancelOrderResult.error && !cancelOrderResult.errorStack &&
            cancelOrderResult.statusCode >= 200 && cancelOrderResult.statusCode < 304) {

            // This file returns a JSON object
            return success(cancelOrderResult);
        } else {
            let message = `🔔 Shopify Status Code from the 'Cancel Process' is ${cancelOrderResult.statusCode} (should be 200)`;
            return failure(message);
        }
    } catch (err) {
        let message = 'Shopify Call Fails to do the Cancel';
        log.error(err, { err, msg: message });
        return failure(errorCleanUp(err, message));
    }
};
