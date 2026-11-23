import { Resend } from 'resend';
import { ENV, getMissingResendVars, isResendConfigured } from '../config/env.ts';
import { ServiceNotConfiguredError } from './supabase.ts';

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!isResendConfigured()) {
    throw new ServiceNotConfiguredError(
      'Resend email service is not configured. Missing environment variable: RESEND_API_KEY',
      getMissingResendVars(),
    );
  }
  if (!resendClient) {
    resendClient = new Resend(ENV.RESEND_API_KEY);
  }
  return resendClient;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendOtpEmail(params: {
  to: string;
  otpCode: string;
  isAdmin: boolean;
  language: 'ar' | 'en';
}): Promise<{ id: string }> {
  const resend = getResendClient();
  const safeCode = escapeHtml(params.otpCode);
  const isAr = params.language === 'ar';

  const subject = isAr
    ? `رمز التحقق الخاص بك في MourTrading: ${safeCode}`
    : `Your MourTrading Verification Code: ${safeCode}`;

  const roleNoteAr = params.isAdmin
    ? 'طلب دخول لحساب المسؤول المحمي (Admin).'
    : 'طلب تسجيل دخول أو إنشاء حساب بدون كلمة مرور.';
  const roleNoteEn = params.isAdmin
    ? 'Protected Administrator sign-in verification request.'
    : 'Passwordless account verification request.';

  const html = `
<!doctype html>
<html dir="${isAr ? 'rtl' : 'ltr'}" lang="${isAr ? 'ar' : 'en'}">
  <body style="margin:0;padding:0;background-color:#070A0F;font-family:Arial,Helvetica,sans-serif;color:#F1F5F9;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#070A0F;padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#0D131F;border:1px solid rgba(212,175,55,0.3);border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:20px;font-weight:700;color:#D4AF37;letter-spacing:0.5px;">MourTrading</div>
                <div style="font-size:12px;color:#94A3B8;margin-top:4px;">Smart Crypto Market Intelligence</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h2 style="margin:0 0 12px 0;font-size:18px;color:#F8FAFC;">
                  ${isAr ? 'رمز التحقق لمرة واحدة (OTP)' : 'One-Time Verification Code'}
                </h2>
                <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#CBD5E1;">
                  ${isAr ? roleNoteAr : roleNoteEn}
                </p>
                <div style="background-color:#070A0F;border:1px solid rgba(212,175,55,0.45);border-radius:10px;padding:18px;text-align:center;margin:20px 0;">
                  <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#E5C158;">
                    ${safeCode}
                  </span>
                </div>
                <p style="margin:0 0 8px 0;font-size:13px;color:#94A3B8;">
                  ${isAr
                    ? 'تنتهي صلاحية هذا الرمز خلال 5 دقائق. الحد الأقصى للمحاولات الخاطئة هو 5 محاولات.'
                    : 'This code expires in 5 minutes. Maximum 5 incorrect verification attempts are allowed.'}
                </p>
                <p style="margin:0;font-size:12px;color:#64748B;">
                  ${isAr
                    ? 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.'
                    : 'If you did not request this code, you can safely ignore this email.'}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const text = isAr
    ? `MourTrading — رمز التحقق الخاص بك هو: ${params.otpCode}\nصالح لمدة 5 دقائق.`
    : `MourTrading — Your verification code is: ${params.otpCode}\nValid for 5 minutes.`;

  const { data, error } = await resend.emails.send({
    from: ENV.RESEND_FROM_EMAIL,
    to: [params.to],
    subject,
    html,
    text,
  });

  if (error || !data?.id) {
    throw new Error(error?.message || 'Failed to send OTP email via Resend');
  }

  return { id: data.id };
}

export async function sendPriceAlertEmail(params: {
  to: string;
  symbol: string;
  condition: string;
  targetPrice: number;
  currentPrice: number;
}): Promise<void> {
  if (!isResendConfigured()) return;
  const resend = getResendClient();
  const safeSymbol = escapeHtml(params.symbol);
  const safeCondition = escapeHtml(params.condition);

  await resend.emails.send({
    from: ENV.RESEND_FROM_EMAIL,
    to: [params.to],
    subject: `MourTrading Alert: ${safeSymbol} reached ${params.currentPrice}`,
    html: `
      <div style="background:#070A0F;color:#F1F5F9;padding:24px;font-family:Arial,sans-serif;border-radius:12px;">
        <h2 style="color:#D4AF37;margin:0 0 12px 0;">MourTrading Price Alert</h2>
        <p style="margin:0 0 8px 0;"><strong>Pair:</strong> ${safeSymbol}</p>
        <p style="margin:0 0 8px 0;"><strong>Condition:</strong> ${safeCondition} (${params.targetPrice})</p>
        <p style="margin:0;"><strong>Verified Market Price:</strong> $${params.currentPrice}</p>
      </div>
    `,
    text: `MourTrading Price Alert: ${params.symbol} (${params.condition} ${params.targetPrice}) — Current Price: ${params.currentPrice}`,
  });
}
