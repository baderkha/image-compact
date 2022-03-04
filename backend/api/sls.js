
const app = require('./main');
const handler = require('serverless-express/handler')

module.exports = handler(app);