import type { NextApiRequest, NextApiResponse } from 'next';
import { EmailService } from '@/utils/email/emailService';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { accountName, message } = req.body;

    if (!accountName || !message) {
      return res.status(400).json({ error: 'Account name and message are required.' });
    }

    const html = `
      <div style="font-family: Arial, sans-serif; font-size: 16px; color: #333;">
        <h2>FSai Account Deletion Request</h2>
        <p><strong>Account Name:</strong> ${accountName}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br/>')}</p>
      </div>
    `;

    const emailService = new EmailService();
    await emailService.sendReport({
      to: ['info@leadprospecting.ai'],
      subject: `FSai Account Deletion Request - ${accountName}`,
      html,
    });

    return res.status(200).json({ success: true, message: 'Deletion request sent successfully.' });
  } catch (error) {
    console.error('[Delete Account Email Error]', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
