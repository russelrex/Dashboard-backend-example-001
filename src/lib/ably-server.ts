import Ably from 'ably';

const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

export default ably;
