import Cors from 'cors';
import initMiddleware from './init-middleware';

const cors = initMiddleware(
  Cors({
    origin: [
      'http://localhost:3000',
      'https://www.leadprospecting.ai',
      'https://www.fieldserv.ai'
    ],
    methods: ['GET', 'POST', 'OPTIONS', 'DELETE', 'PATCH', 'PUT'],
  })
);

export default cors;
