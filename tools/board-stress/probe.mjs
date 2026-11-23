import { connect } from './cdp.mjs';
const c = await connect(+process.argv[2] || 9333, new RegExp(process.argv[3] || '.'));
console.log(c.target.url);
console.log(await c.eval(process.argv[4] || 'document.title'));
c.close(); process.exit(0);
