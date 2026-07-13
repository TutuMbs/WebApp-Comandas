const nodemailer = require('nodemailer');

function buildTransport() {
  if (process.env.SMTP_URL) {
    return nodemailer.createTransport(process.env.SMTP_URL);
  }

  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    });
  }

  return null;
}

async function sendPasswordResetEmail({ to, establishmentName, resetUrl }) {
  const transport = buildTransport();

  if (!transport) {
    return { sent: false, transport: null };
  }

  const from = process.env.MAIL_FROM || 'no-reply@comandas.local';

  await transport.sendMail({
    from,
    to,
    subject: `Reset de senha - ${establishmentName}`,
    text: `Use este link para redefinir sua senha: ${resetUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5">
        <h2>Redefinição de senha</h2>
        <p>Olá, ${establishmentName}.</p>
        <p>Use o link abaixo para redefinir sua senha:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>Se você não solicitou isso, pode ignorar esta mensagem.</p>
      </div>
    `,
  });

  return { sent: true, transport };
}

module.exports = {
  sendPasswordResetEmail,
};
