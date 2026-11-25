// If this ever runs during a crawl, the crawler executed repo code.
require('node:fs').writeFileSync(__dirname + '/EXECUTED', String(Date.now()));
module.exports = { trapped: true };
