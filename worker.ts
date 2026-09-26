import { httpServerHandler } from 'cloudflare:node';
import { app } from './server/index';

app.listen(8787);

export default httpServerHandler({ port: 8787 });
