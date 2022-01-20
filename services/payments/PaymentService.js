import * as dynamoDbLib from '../../common/libs/aws/dynamodb-lib';
import {
    PaymentGateways
} from '../../common/Constants';

import * as ShopifyService from './shopify/ShopifyService';

export const calculateAmount = (platform_fees, payment_due) => {
    return platform_fees.reduce((sum, fee) => {
        if (fee && fee.value) {
            if (fee.currency_code === '%') {
                sum += payment_due * (fee.value / 100);
            } else {
                sum += fee.value;
            }
        }
        return Math.round(sum * 100) / 100;
    }, 0);
};

export const putPayment = async (paymentMethod, payment) => {

    payment.payment_method = paymentMethod;

    let params = {
        TableName: `${process.env.STAGE}-payment-system`,
        Item: payment
    };

    await dynamoDbLib.put(params);

    return payment;
};

export const getPayment = async (shop_orderid) => {

    let params = {
        TableName: `${process.env.STAGE}-payment-system`,
        Key: {
            shop_orderid
        }
    };

    return await dynamoDbLib.get({ shop_orderid });
};

export const getCurrentPaymentGateway = (paymentGateway) => {

    let PaymentGatewayService = ShopifyService;

    if (paymentGateway === PaymentGateways.Shopify || paymentGateway === PaymentGateways.ShopifyPayments) {
        PaymentGatewayService = ShopifyService;
    }

    return PaymentGatewayService;
};


