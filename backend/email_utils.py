"""QQ 邮箱 SMTP 发送验证邮件"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST = "smtp.qq.com"
SMTP_PORT = 465
SENDER_EMAIL = "3320780962@qq.com"
SENDER_PASS = "lipmzdydqsgzdagb"  # QQ SMTP 授权码（非邮箱密码）


def send_verification_email(to_email: str, token: str, base_url: str = "http://localhost:8000") -> bool:
    """发送验证邮件，成功返回 True"""
    verify_link = f"{base_url}/api/auth/verify/{token}"

    msg = MIMEMultipart()
    msg["From"] = f"Gesture Earth <{SENDER_EMAIL}>"
    msg["To"] = to_email
    msg["Subject"] = "Gesture Earth - 请验证您的邮箱"

    body = f"""您好！

感谢注册 Gesture Earth Demo。

请点击以下链接验证您的邮箱地址：
{verify_link}

如果无法点击，请将链接复制到浏览器地址栏。

此邮件由系统自动发送，请勿回复。
"""
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10)
        server.login(SENDER_EMAIL, SENDER_PASS)
        server.sendmail(SENDER_EMAIL, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"[EMAIL] 发送失败: {e}")
        return False
