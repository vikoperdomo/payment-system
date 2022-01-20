const slsw = require('serverless-webpack');
const nodeExternals = require('webpack-node-externals');
const path = require('path');

module.exports = {
    entry: slsw.lib.entries,
    target: 'node',
    stats: 'errors-only',
    resolve: {
        alias: {
            '@': path.join(__dirname, 'src')
        },
        extensions: ['.js', '.json']
    },
    // Generate sourcemaps for proper error messages
    devtool: 'source-map',
    // Since 'aws-sdk' is not compatible with webpack,
    // we exclude all node dependencies
    externals: [nodeExternals(), 'dd-trace', 'datadog-lambda-js'],
    mode: slsw.lib.webpack.isLocal ? 'development' : 'production',
    optimization: {
        minimize: slsw.lib.webpack.isLocal === 'production'
    },
    performance: {
        // Turn off size warnings for entry points
        hints: false
    },
    // Run babel on all .js files and skip those in node_modules
    module: {
        rules: [
            {
                enforce: 'pre',
                test: /\.js$/,
                use: [
                    {
                        loader: 'eslint-loader',
                        options: {
                            configFile: '.eslintrc.yaml',
                            emitWarning: true,
                            fix: true
                        }
                    }
                ],
                exclude: ['/node_modules/', '/sls-services/']
            },
            {
                test: /\.js$/,
                loader: 'babel-loader',
                include: __dirname,
                exclude: ['/node_modules/', '/sls-services/']
            }
        ]
    }
};
