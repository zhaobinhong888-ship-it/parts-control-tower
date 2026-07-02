var express = require('express');
var nodemailer = require('nodemailer');
var cors = require('cors');
var path = require('path');
var fs = require('fs');

var app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

var CFG = path.join(__dirname, 'smtp-config.json');
var STATE = path.join(__dirname, 'state.json');
var LOGF = path.join(__dirname, 'server-log.txt');

function loadCfg() {
  // Cloud: read from env vars. Local: read from file.
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT)||465,
      user: process.env.SMTP_USER||'', pass: process.env.SMTP_PASS||'',
      recipients: process.env.SMTP_TO||'', editPassword: process.env.EDIT_PWD||'admin123'
    };
  }
  try { return JSON.parse(fs.readFileSync(CFG,'utf-8')); } catch(e) { return {}; }
}
function saveCfg(c) {
  if (process.env.SMTP_HOST) return; // Cloud: config managed via env vars
  fs.writeFileSync(CFG, JSON.stringify(c,null,2), 'utf-8');
}

function loadSharedState() {
  try { return JSON.parse(fs.readFileSync(STATE,'utf-8')); } catch(e) { return null; }
}
function saveSharedState(s) {
  s.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE, JSON.stringify(s,null,2), 'utf-8');
  log('STATE_SAVED');
}

function log(msg) {
  try { fs.appendFileSync(LOGF, '['+new Date().toISOString()+'] '+msg+'\n'); } catch(e) {}
}

// ============ SMTP Config API ============
app.get('/api/config', function(req, res) {
  var c = loadCfg();
  res.json({ host: c.host||'', port: c.port||465, user: c.user||'', pass: c.pass?'***':'', recipients: c.recipients||'', hasEditPassword: !!c.editPassword });
});

app.post('/api/config', function(req, res) {
  var b = req.body, c = loadCfg();
  if (b.host !== undefined) c.host = b.host;
  if (b.port !== undefined) c.port = b.port;
  if (b.user !== undefined) c.user = b.user;
  if (b.pass !== undefined && b.pass !== '***') c.pass = b.pass;
  if (b.recipients !== undefined) c.recipients = b.recipients;
  if (b.editPassword !== undefined) c.editPassword = b.editPassword;
  saveCfg(c);
  res.json({ ok: true });
});

// ============ Shared State API ============
app.get('/api/state', function(req, res) {
  var s = loadSharedState();
  if (!s) return res.json({ exists: false, state: null });
  // Return state but mask SMTP password
  var out = JSON.parse(JSON.stringify(s));
  if (out.smtpPass) out.smtpPass = '***';
  res.json({ exists: true, state: out, updatedAt: s.updatedAt });
});

app.post('/api/state', function(req, res) {
  var b = req.body;
  var c = loadCfg();
  var editPwd = c.editPassword || 'admin123'; // default password if not set

  if (!b.password || b.password !== editPwd) {
    return res.status(403).json({ ok: false, msg: '编辑密码错误，无权限修改' });
  }

  // Conflict detection: if client sent updatedAt, check against server
  var current = loadSharedState();
  if (current && b.updatedAt && current.updatedAt !== b.updatedAt) {
    return res.status(409).json({ ok: false, msg: '数据已被他人修改，请刷新页面后重新编辑', conflict: true });
  }

  // Save the new state (preserve smtpPass from config)
  if (b.state.smtpPass === '***' && c.pass) {
    b.state.smtpPass = c.pass;
  }
  saveSharedState(b.state);
  log('STATE_SAVED_BY_CLIENT');
  res.json({ ok: true, updatedAt: b.state.updatedAt || new Date().toISOString() });
});

// ============ Auth API ============
app.post('/api/auth', function(req, res) {
  var c = loadCfg();
  var editPwd = c.editPassword || 'admin123';
  if (req.body.password === editPwd) {
    res.json({ ok: true, token: 'edit-session-' + Date.now() });
  } else {
    res.status(401).json({ ok: false, msg: '密码错误' });
  }
});

// ============ Email API ============
app.post('/api/send-alert', async function(req, res) {
  try {
    var b = req.body, c = loadCfg();
    var transporter = nodemailer.createTransport({
      host: c.host, port: c.port||465, secure: true,
      auth: { user: c.user, pass: c.pass },
      tls: { rejectUnauthorized: false }
    });
    var t = new Date().toLocaleString('zh-CN');
    var lines = (b.body||'').split('\n').map(function(l){return '<p style="margin:0 0 8px;font-size:14px">'+l+'</p>';}).join('');
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'+
      '<div style="font-family:PingFang SC,Microsoft YaHei,Arial,sans-serif;max-width:600px;margin:0 auto;border:2px solid #ef4444;border-radius:10px;overflow:hidden">'+
      '<div style="background:#ef4444;color:#fff;padding:16px 24px;font-size:20px;font-weight:bold">零件拉动控制塔预警</div>'+
      '<div style="padding:24px;background:#1a1a2e;color:#e0e0e0;line-height:2">'+lines+'</div>'+
      '<div style="background:#111;color:#666;padding:12px 24px;font-size:12px">此邮件由零件拉动控制塔自动发送 - '+t+'</div>'+
      '</div></body></html>';
    await transporter.sendMail({ from: c.user, to: c.recipients, subject: b.subject||'控制塔预警', html: html });
    log('SENT_OK');
    res.json({ ok: true });
  } catch(err) { log('SEND_ERR: '+err.message); res.status(500).json({ ok: false, msg: err.message }); }
});

app.post('/api/test-email', async function(req, res) {
  try {
    var c = loadCfg();
    var transporter = nodemailer.createTransport({
      host: c.host, port: c.port||465, secure: true,
      auth: { user: c.user, pass: c.pass }, tls: { rejectUnauthorized: false }
    });
    var t = new Date().toLocaleString('zh-CN');
    await transporter.sendMail({ from: c.user, to: c.recipients, subject: '控制塔邮件测试',
      html: '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'+
        '<div style="font-family:sans-serif;padding:20px;background:#f0fdf4;border:2px solid #10b981;border-radius:10px">'+
        '<h2 style="color:#10b981">邮件服务配置成功</h2><p>零件拉动控制塔的预警通知功能已就绪。</p>'+
        '<p style="color:#666">发送时间：'+t+'</p></div></body></html>' });
    log('TEST_OK'); res.json({ ok: true });
  } catch(err) { log('TEST_ERR: '+err.message); res.status(500).json({ ok: false, msg: err.message }); }
});

// ============ Background Alert Checker (runs independently, no browser needed) ============
var ALERTS_FILE = path.join(__dirname, 'alerts-sent.json');
function loadAlertsSent() { try { return JSON.parse(fs.readFileSync(ALERTS_FILE,'utf-8')); } catch(e) { return {}; } }
function saveAlertsSent(a) { fs.writeFileSync(ALERTS_FILE, JSON.stringify(a,null,2), 'utf-8'); }

function checkBackgroundAlerts(){
  var s = loadSharedState(); if (!s) return;
  var cfg = loadCfg(); if (!cfg.host || !cfg.user) return;
  var now = new Date();
  var prodStart = new Date(s.productionStart);
  var productionEnd = new Date(prodStart.getTime() + s.productionDays*24*3600000);
  if (now > productionEnd) return; // Production ended, no alerts needed

  var sent = loadAlertsSent();
  var overdueVehicles = [];

  (s.vehicles||[]).forEach(function(v){
    if (!v.dockTime && v.status==='pending' && v.depLatest){
      var depLatest = new Date(v.depLatest);
      var warnTime = new Date(depLatest.getTime() - 2*3600000); // 2h before latest departure
      if (now >= warnTime && depLatest > now){
        overdueVehicles.push({name:v.name, depLatest:v.depLatest, warning:true});
      } else if (now >= depLatest){
        overdueVehicles.push({name:v.name, depLatest:v.depLatest, warning:false});
      }
    }
  });

  if (overdueVehicles.length === 0) return;

  var key = overdueVehicles.map(function(v){return v.name+'_'+(v.warning?'w':'o');}).join(',');
  // Don't spam: max 1 alert per 10 min for same vehicles
  if (sent[key] && (now - new Date(sent[key])) < 600000) return;

  // Build and send alert email
  var names = overdueVehicles.map(function(v){return v.name;}).join(',');
  var hasOverdue = overdueVehicles.some(function(v){return !v.warning;});
  var title = hasOverdue ? '🚨 发车超时预警 - 后台' : '⚠️ 发车预警(不足2h) - 后台';
  var body = names + (hasOverdue ? ' 已超过最晚发车时间！' : ' 距最晚发车不足2小时！') +
    '\n请登录控制塔填报：https://www.dsfile.vip/control-tower/\n预警车辆：' +
    overdueVehicles.map(function(v){return v.name+' 最晚发车 '+new Date(v.depLatest).toLocaleString('zh-CN');}).join('; ');

  try {
    var transporter = nodemailer.createTransport({
      host: cfg.host, port: cfg.port||465, secure: true,
      auth: { user: cfg.user, pass: cfg.pass }, tls: { rejectUnauthorized: false }
    });
    var t = new Date().toLocaleString('zh-CN');
    var lines = body.split('\n').map(function(l){return '<p style="margin:0 0 8px;font-size:14px">'+l+'</p>';}).join('');
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>'+
      '<div style="font-family:PingFang SC,Microsoft YaHei,Arial,sans-serif;max-width:600px;margin:0 auto;border:2px solid #ef4444;border-radius:10px;overflow:hidden">'+
      '<div style="background:#ef4444;color:#fff;padding:16px 24px;font-size:20px;font-weight:bold">零件拉动控制塔预警</div>'+
      '<div style="padding:24px;background:#1a1a2e;color:#e0e0e0;line-height:2">'+lines+'</div>'+
      '<div style="background:#111;color:#666;padding:12px 24px;font-size:12px">此邮件由后台定时扫描自动发送 - '+t+'</div>'+
      '</div></body></html>';
    transporter.sendMail({ from: cfg.user, to: cfg.recipients, subject: title, html: html }).then(function(info){
      sent[key] = now.toISOString();
      saveAlertsSent(sent);
      log('BG_ALERT_SENT: '+names);
    }).catch(function(err){ log('BG_ALERT_ERR: '+err.message); });
  } catch(err){ log('BG_ALERT_ERR: '+err.message); }
}

var PORT = process.env.PORT || 3456;
app.listen(PORT, function() {
  log('STARTED:'+PORT); console.log('Server:'+PORT);
  // Run background alert check every 5 minutes
  checkBackgroundAlerts();
  setInterval(checkBackgroundAlerts, 5*60*1000);
});
