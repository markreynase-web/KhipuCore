// src/mailer.js
// Envío de correo vía SMTP genérico (nodemailer) -- funciona con cualquier
// proveedor (Gmail con contraseña de aplicación, SendGrid, Brevo, Resend,
// Mailtrap para pruebas, un SMTP propio...) porque nodemailer solo necesita
// host/puerto/usuario/clave, nunca un SDK específico de proveedor. Ver
// .env.example para las variables necesarias.
//
// Nada de esto se hardcodea -- todo sale de variables de entorno. Si no
// están configuradas, enviarCorreoRecuperacion() no revienta: registra el
// enlace en el log del servidor (ver nota abajo) para poder probar el flujo
// completo en desarrollo sin credenciales SMTP reales.

import nodemailer from 'nodemailer';

function transporteConfigurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

let transportadorCache = null;
function obtenerTransportador() {
  if (!transportadorCache) {
    transportadorCache = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    });
  }
  return transportadorCache;
}

function plantillaRecuperacion({ nombre, resetUrl }) {
  // HTML de correo: estilos inline (no <style> en <head>) porque muchos
  // clientes de correo ignoran o recortan hojas de estilo -- es la forma
  // confiable de que se vea igual en Gmail/Outlook/Apple Mail. Mismos
  // colores de marca que login.html (--ink/--brand-2/--teal/--cyan).
  return `
<!DOCTYPE html>
<html lang="es">
<body style="margin:0; padding:0; background:#F3F8FC; font-family:'Segoe UI', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F8FC; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px; background:#FFFFFF; border-radius:16px; overflow:hidden;">
        <tr>
          <td style="background:#0E1B45; padding:28px 32px;">
            <span style="font-size:20px; font-weight:700; color:#F3F8FC;">Khipu<span style="color:#2EE2CE;">Core</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px; font-size:15px; line-height:1.55; color:#16295C;">Hola${nombre ? ` ${nombre}` : ''},</p>
            <p style="margin:0 0 24px; font-size:15px; line-height:1.55; color:#16295C;">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta de KhipuCore.
              Haz clic en el siguiente botón para crear una nueva contraseña:
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
              <tr><td style="border-radius:999px; background:#16295C;">
                <a href="${resetUrl}" style="display:inline-block; padding:14px 28px; font-size:14.5px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:999px;">Restablecer contraseña</a>
              </td></tr>
            </table>
            <p style="margin:0 0 8px; font-size:13px; line-height:1.5; color:#4E5A78;">Este enlace expirará en 30 minutos.</p>
            <p style="margin:0; font-size:13px; line-height:1.5; color:#4E5A78;">Si no solicitaste este cambio, puedes ignorar este correo -- tu contraseña actual sigue funcionando igual.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px; border-top:1px solid #E1E7F0;">
            <p style="margin:0; font-size:12px; color:#9AA6C0;">KhipuCore -- El conocimiento ancestral convertido en inteligencia empresarial.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * @returns {Promise<{enviado:boolean, motivo?:string}>} -- nunca lanza: el
 * llamador (routes/auth.js) siempre responde el mismo mensaje genérico al
 * usuario, se haya podido enviar el correo o no.
 */
export async function enviarCorreoRecuperacion({ to, nombre, resetUrl }) {
  if (!transporteConfigurado()) {
    // Sin SMTP_HOST/SMTP_USER/SMTP_PASSWORD configurados (ver .env.example)
    // no hay forma de mandar el correo de verdad. En vez de fallar en
    // silencio, se deja el enlace acá -- permite probar el flujo completo
    // (crear token, abrir el enlace, cambiar la contraseña) en desarrollo
    // sin depender de credenciales SMTP reales. En producción, este log es
    // la señal de que faltan configurar esas variables en Render.
    console.warn(`[mailer] SMTP no configurado -- enlace de recuperación para ${to}:\n  ${resetUrl}`);
    return { enviado: false, motivo: 'smtp_no_configurado' };
  }
  try {
    await obtenerTransportador().sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject: 'Restablece tu contraseña de KhipuCore',
      html: plantillaRecuperacion({ nombre, resetUrl })
    });
    return { enviado: true };
  } catch (err) {
    console.error('No se pudo enviar el correo de recuperación:', err.message);
    return { enviado: false, motivo: 'error_envio' };
  }
}
