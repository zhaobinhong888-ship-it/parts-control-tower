var express = require('express');
var nodemailer = require('nodemailer');
var cors = require('cors');
var path = require('path');
var fs = require('fs');

var app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

var CFG = path.join(__dirname, 'smtp-config.json');

function load() {
  try { return JSON.parse(fs.readFileSync(CFG, 'utf-8')); }
  catch(e) { return {}; }
}
function save(c) { fs.writeFileSync(CFG, JSON.stringify(c, null, 2), 'utf-8'); }

function log(msg) {
  var ts = new Date().toISOString();
  fs.appendFileSync(path.join(__dirname, 'server-log.txt'), '[' + ts + '] ' + msg + '\n');
}

app.get('/api/config', function(req, res) {
  var c = load();
  res.json({ host: c.host || '', port: c.port || 465, user: c.user || '', pass: c.pass ? '***' : '', recipients: c.recipients || '' });
});

app.post('/api/config', function(req, res) {
  var b = req.body, c = load();
  if (b.host !== undefined) c.host = b.host;
  if (b.port !== undefined) c.port = b.port;
  if (b.user !== undefined) c.user = b.user;
  if (b.pass !== undefined && b.pass !== '***') c.pass = b.pass;
  if (b.recipients !== undefined) c.recipients = b.recipients;
  save(c);
  res.json({ ok: true });
});

app.post('/api/send-alert', async function(req, res) {
  try {
    var b = req.body;
    var c = load();

    var transporter = nodemailer.createTransport({
      host: c.host, port: c.port || 465, secure: true,
      auth: { user: c.user, pass: c.pass },
      tls: { rejectUnauthorized: false }
    });

    var t = new Date().toLocaleString('zh-CN');

    // Build HTML with Chinese text
    var lines = (b.body || '').split('\n').map(function(l) {
      return '<p style="margin:0 0 8px;font-size:14px">' + l + '</p>';
    }).join('');

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
      '<div style="font-family:PingFang SC,Microsoft YaHei,Arial,sans-serif;max-width:600px;margin:0 auto;border:2px solid #ef4444;border-radius:10px;overflow:hidden">' +
      '<div style="background:#ef4444;color:#fff;padding:16px 24px;font-size:20px;font-weight:bold">零件拉动控制塔预警</div>' +
      '<div style="padding:24px;background:#1a1a2e;color:#e0e0e0;line-height:2">' + lines + '</div>' +
      '<div style="background:#111;color:#666;padding:12px 24px;font-size:12px">此邮件由零件拉动控制塔自动发送 - ' + t + '</div>' +
      '</div></body></html>';

    // Send HTML-only email (single part, no multipart)
    var info = await transporter.sendMail({
      from: c.user,
      to: c.recipients,
      subject: b.subject || '控制塔预警',
      html: html
    });

    log('SENT_OK: ' + info.messageId);
    res.json({ ok: true });
  } catch (err) {
    log('ERROR: ' + err.message);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

app.post('/api/test-email', async function(req, res) {
  try {
    var c = load();
    var transporter = nodemailer.createTransport({
      host: c.host, port: c.port || 465, secure: true,
      auth: { user: c.user, pass: c.pass },
      tls: { rejectUnauthorized: false }
    });
    var t = new Date().toLocaleString('zh-CN');
    await transporter.sendMail({
      from: c.user,
      to: c.recipients,
      subject: '控制塔邮件测试',
      html: '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        '<div style="font-family:sans-serif;padding:20px;background:#f0fdf4;border:2px solid #10b981;border-radius:10px">' +
        '<h2 style="color:#10b981">邮件服务配置成功</h2>' +
        '<p>零件拉动控制塔的预警通知功能已就绪。</p>' +
        '<p style="color:#666">发送时间：' + t + '</p></div></body></html>'
    });
    log('TEST_OK');
    res.json({ ok: true });
  } catch (err) {
    log('TEST_ERR: ' + err.message);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

var PORT = process.env.PORT || 3456;
app.listen(PORT, function() {
  log('STARTED:' + PORT);
  console.log('Server:' + PORT);
});
