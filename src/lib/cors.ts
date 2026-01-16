import Cors from 'cors';
import initMiddleware from './init-middleware';

const cors = initMiddleware(
  Cors({
    origin: [
      'http://localhost:3000',
      'https://www.leadprospecting.ai',
      'https://www.fieldserv.ai',
      'https://dashboard-example-001-git-main-russelrexs-projects.vercel.app',
      'https://dashboard-example-001.vercel.app',
    ],
    methods: ['GET', 'POST', 'OPTIONS', 'DELETE', 'PATCH', 'PUT'],
  })
);

export default cors;
