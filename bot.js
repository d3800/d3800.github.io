// =================================================================
// Telegram Bot для LottoDrop Mini App
// Поддержка лотерейных билетов, ТВ-тиража, кредитов, Stars магазина (@opcevz),
// рефералов, P2P биржи и админ-команд (/give, /ban, /unban, /prefix)
// =================================================================
const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || 'ВАШ_ТОКЕН_ОТ_BOTFATHER';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-domain.onrender.com';
const DB_FILE = path.join(__dirname, 'database.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1190234';
const CREATOR_USERNAME = 'opcevz';

function fmtUSD(val) {
    const num = Number(val || 0);
    return (num < 0 ? '-$' : '$') + Math.abs(num).toFixed(2);
}

function getDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch(e) {}
    return { players: {}, p2pListings: [], starsOrders: [] };
}

function saveDB(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch(e) {}
}

function apiRequest(method, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let resBody = '';
            res.on('data', chunk => resBody += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(resBody));
                } catch (e) {
                    resolve({ ok: false, description: resBody });
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Отправка приветственного сообщения
async function sendWelcome(chatId, user, refParam) {
    const db = getDB();
    const userId = String(user.id);
    const username = (user.username || `user${userId}`).replace('@', '').toLowerCase();

    // Регистрация игрока
    if (!db.players[userId]) {
        db.players[userId] = {
            id: userId,
            chatId: chatId,
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Игрок',
            username: username,
            balance: 100.0,
            creditDebt: 0.0,
            taxDue: 0.0,
            ticketsInteracted: 0,
            collection: [],
            prefixText: '',
            prefixCss: '',
            isBanned: false,
            referredBy: null,
            referrals: [],
            lastSeen: Date.now()
        };

        if (refParam && String(refParam) !== userId) {
            const cleanRef = String(refParam).replace('ref_', '').toLowerCase();
            const referrer = db.players[cleanRef] || Object.values(db.players).find(p => p.username === cleanRef);
            if (referrer && referrer.id !== userId) {
                db.players[userId].referredBy = referrer.id;
                if (!referrer.referrals) referrer.referrals = [];
                if (!referrer.referrals.includes(userId)) referrer.referrals.push(userId);
                if (referrer.chatId) {
                    await apiRequest('sendMessage', {
                        chat_id: referrer.chatId,
                        text: `🎉 *Новый реферал в LottoDrop!*\n\nПользователь @${username} присоединился по вашей ссылке!`,
                        parse_mode: 'Markdown'
                    });
                }
            }
        }
    } else {
        db.players[userId].chatId = chatId;
        db.players[userId].username = username;
        db.players[userId].lastSeen = Date.now();
    }
    saveDB(db);

    const player = db.players[userId];
    const realNet = (player.balance || 0) - (player.creditDebt || 0);

    const text = `🎟️ Привет, *${user.first_name || 'Игрок'}*!\n\n` +
                 `Добро пожаловать в *Сполото* — реалистичный симулятор лотерейных билетов!\n\n` +
                 `🔥 *Особенности игры:*\n` +
                 `• 📜 *Настоящие бумажные билеты:* фактурная хлопковая бумага, защитные волокна, отрывная перфорация и шкала CMYK!\n` +
                 `• 🪙 *5 серий скретч-лотерей:* «Сполото», «Спорткото», «Золотая полкова», «Рузское лото», «Печталлион»!\n` +
                 `• 🆓 *Бесплатные билеты:* все билеты $0, оплачивается лишь налог от взаимодействий.\n` +
                 `• 💳 *Кредит на 48 часов:* возврат +15% (при просрочке +30% и уход в красный минус).\n` +
                 `• 💸 *Мгновенные переводы:* переводите $ любому игроку по @username или ID.\n` +
                 `• 🏆 *Честный Лидерборд:* оценивается *ТОЛЬКО по реальным деньгам* (Баланс минус Кредит)!\n` +
                 `• 🔄 *P2P Биржа:* покупайте и продавайте $ за реальные рубли/USDT с лимитами.\n` +
                 `• ⭐ *Stars Магазин:* официальная покупка за звёзды у @${CREATOR_USERNAME}.\n\n` +
                 `💰 Ваш капитал: *${fmtUSD(player.balance)}*\n` +
                 `📊 Чистые средства (в топе): *${fmtUSD(realNet)}*\n\n` +
                 `Нажмите кнопку ниже, чтобы начать:`;

    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: '🎟️ Играть в Сполото',
                    web_app: { url: WEBAPP_URL }
                }
            ],
            [
                {
                    text: '⭐ Магазин Stars (@opcevz)',
                    url: `https://t.me/${CREATOR_USERNAME}`
                },
                {
                    text: '📊 Мой Баланс',
                    callback_data: 'my_balance'
                }
            ],
            [
                {
                    text: '💬 Создатель & Поддержка @opcevz',
                    url: `https://t.me/${CREATOR_USERNAME}`
                }
            ]
        ]
    };

    try {
        await apiRequest('sendMessage', {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
        });
    } catch (e) {
        console.error('[BOT ERROR]:', e.message);
    }
}

// Обработка текстовых команд
async function handleCommand(chatId, text, user) {
    const parts = text.split(' ');
    const cmd = parts[0].toLowerCase();
    const db = getDB();
    const userId = String(user.id);
    const username = (user.username || '').toLowerCase();

    // 1. /balance
    if (cmd === '/balance') {
        const player = db.players[userId];
        const bal = player ? player.balance || 0 : 100.0;
        const debt = player ? player.creditDebt || 0 : 0.0;
        const real = bal - debt;
        const tax = player ? player.taxDue || 0 : 0.0;
        const prefix = player?.prefixText ? ` [${player.prefixText}]` : '';

        await apiRequest('sendMessage', {
            chat_id: chatId,
            text: `📊 *Состояние счёта Сполото*${prefix}:\n\n` +
                  `🏆 *Чистые средства (в Лидерборде):* ${fmtUSD(real)}\n` +
                  `💵 *Баланс на руках:* ${fmtUSD(bal)}\n` +
                  `💳 *Кредитный долг:* ${fmtUSD(debt)}\n` +
                  `🧾 *Налог к оплате:* ${fmtUSD(tax)}\n\n` +
                  `_Кредитные средства не дают очков в лидерборде!_`,
            parse_mode: 'Markdown'
        });
        return;
    }

    // 2. /transfer @username <amount>
    if (cmd === '/transfer' || cmd === '/pay') {
        const targetClean = (parts[1] || '').replace('@', '').toLowerCase();
        const amt = parseFloat(parts[2]);

        if (!targetClean || isNaN(amt) || amt <= 0) {
            return apiRequest('sendMessage', {
                chat_id: chatId,
                text: 'ℹ️ *Использование:* `/transfer @username 50` или `/transfer ID 100`',
                parse_mode: 'Markdown'
            });
        }

        const sender = db.players[userId];
        if (!sender) {
            return apiRequest('sendMessage', { chat_id: chatId, text: '❌ Сначала запустите игру через /start!' });
        }
        if (sender.isBanned) {
            return apiRequest('sendMessage', { chat_id: chatId, text: '❌ Ваш аккаунт заблокирован.' });
        }
        if ((sender.balance || 0) < amt) {
            return apiRequest('sendMessage', {
                chat_id: chatId,
                text: `❌ Недостаточно средств. Ваш баланс: *${fmtUSD(sender.balance)}*, нужно: *${fmtUSD(amt)}*.`,
                parse_mode: 'Markdown'
            });
        }

        const recipient = db.players[targetClean] || Object.values(db.players).find(p => (p.username && p.username.toLowerCase() === targetClean) || String(p.id) === targetClean);
        if (!recipient) {
            return apiRequest('sendMessage', {
                chat_id: chatId,
                text: `❌ Игрок «${targetClean}» не найден в системе. Игрок должен хотя бы раз запустить бота.`,
                parse_mode: 'Markdown'
            });
        }

        if (String(recipient.id) === String(sender.id)) {
            return apiRequest('sendMessage', { chat_id: chatId, text: '❌ Нельзя переводить средства самому себе!' });
        }

        if (recipient.isBanned) {
            return apiRequest('sendMessage', { chat_id: chatId, text: '❌ Получатель заблокирован администратором.' });
        }

        sender.balance = Number(((sender.balance || 0) - amt).toFixed(2));
        recipient.balance = Number(((recipient.balance || 0) + amt).toFixed(2));
        saveDB(db);

        await apiRequest('sendMessage', {
            chat_id: chatId,
            text: `✅ *Перевод выполнен!*\n\nВы успешно перевели *${fmtUSD(amt)}* игроку @${recipient.username || recipient.first_name || recipient.id}.\nВаш баланс: *${fmtUSD(sender.balance)}*`,
            parse_mode: 'Markdown'
        });

        if (recipient.chatId) {
            const senderName = sender.username ? `@${sender.username}` : (sender.first_name || `ID ${sender.id}`);
            await apiRequest('sendMessage', {
                chat_id: recipient.chatId,
                text: `💸 *Вам поступил перевод!*\n\nИгрок *${senderName}* перевёл вам *${fmtUSD(amt)}*.\nВаш новый баланс: *${fmtUSD(recipient.balance)}*!`,
                parse_mode: 'Markdown'
            });
        }
        return;
    }

    // 3. /stars
    if (cmd === '/stars') {
        await apiRequest('sendMessage', {
            chat_id: chatId,
            text: `⭐ *Официальный Магазин Telegram Stars*\n\n` +
                  `Пакеты от создателя @${CREATOR_USERNAME}:\n` +
                  `• 50 ⭐ Stars -> $250.00\n` +
                  `• 150 ⭐ Stars -> $1,000.00\n` +
                  `• 500 ⭐ Stars -> $4,500.00\n` +
                  `• 1,500 ⭐ Stars -> $18,000.00\n\n` +
                  `Для покупки напишите напрямую: @${CREATOR_USERNAME}`,
            parse_mode: 'Markdown'
        });
        return;
    }

    // 4. /help
    if (cmd === '/help') {
        await apiRequest('sendMessage', {
            chat_id: chatId,
            text: `📋 *Команды бота Сполото:*\n\n` +
                  `/start — Главное меню и запуск Mini App\n` +
                  `/balance — Проверить реальный баланс и кредит\n` +
                  `/transfer @user 50 — Перевести деньги другому игроку\n` +
                  `/stars — Пакеты за Telegram Stars у @${CREATOR_USERNAME}\n` +
                  `/help — Справка\n\n` +
                  `👑 *Команды администратора:*\n` +
                  `/give @username 500 — выдать баланс\n` +
                  `/ban @username — забанить\n` +
                  `/unban @username — разбанить\n` +
                  `/prefix @username DEVELOPER|SPONSOR|SCAM — выдать префикс`,
            parse_mode: 'Markdown'
        });
        return;
    }

    // Admin Commands check
    const isAdmin = username === CREATOR_USERNAME || db.players[userId]?.prefixText === 'DEVELOPER';

    // 4. /give
    if (cmd === '/give') {
        if (!isAdmin && parts[3] !== ADMIN_PASSWORD) {
            return apiRequest('sendMessage', { chatId, text: '❌ Доступ запрещен. Укажите пароль.' });
        }
        const target = (parts[1] || '').replace('@', '').toLowerCase();
        const amt = parseFloat(parts[2]);
        if (!target || isNaN(amt)) {
            return apiRequest('sendMessage', { chatId, text: 'Использование: /give @username <сумма>' });
        }

        const targetPlayer = Object.values(db.players).find(p => p.username === target || p.id === target);
        if (!targetPlayer) return apiRequest('sendMessage', { chatId, text: `Игрок @${target} не найден` });

        targetPlayer.balance = (targetPlayer.balance || 0) + amt;
        saveDB(db);

        if (targetPlayer.chatId) {
            apiRequest('sendMessage', {
                chat_id: targetPlayer.chatId,
                text: `🎁 Администратор зачислил вам *+${fmtUSD(amt)}*!`,
                parse_mode: 'Markdown'
            });
        }
        return apiRequest('sendMessage', { chatId, text: `✅ Баланс @${target} пополнен на +${fmtUSD(amt)}.` });
    }

    // 5. /ban & /unban
    if (cmd === '/ban' || cmd === '/unban') {
        if (!isAdmin && parts[2] !== ADMIN_PASSWORD) {
            return apiRequest('sendMessage', { chatId, text: '❌ Доступ запрещен.' });
        }
        const target = (parts[1] || '').replace('@', '').toLowerCase();
        const targetPlayer = Object.values(db.players).find(p => p.username === target || p.id === target);
        if (!targetPlayer) return apiRequest('sendMessage', { chatId, text: `Игрок @${target} не найден` });

        const isBan = cmd === '/ban';
        targetPlayer.isBanned = isBan;
        saveDB(db);

        if (targetPlayer.chatId) {
            apiRequest('sendMessage', {
                chat_id: targetPlayer.chatId,
                text: isBan ? '⚠️ *Ваш аккаунт был заблокирован.* Напишите @opcevz' : '✅ *Ваш аккаунт разблокирован.*',
                parse_mode: 'Markdown'
            });
        }
        return apiRequest('sendMessage', { chatId, text: `Пользователь @${target} ${isBan ? 'забанен' : 'разбанен'}.` });
    }

    // 6. /prefix
    if (cmd === '/prefix') {
        if (!isAdmin && parts[3] !== ADMIN_PASSWORD) {
            return apiRequest('sendMessage', { chatId, text: '❌ Доступ запрещен.' });
        }
        const target = (parts[1] || '').replace('@', '').toLowerCase();
        const pref = (parts[2] || '').toUpperCase();
        const targetPlayer = Object.values(db.players).find(p => p.username === target || p.id === target);
        if (!targetPlayer) return apiRequest('sendMessage', { chatId, text: `Игрок @${target} не найден` });

        targetPlayer.prefixText = pref;
        saveDB(db);
        return apiRequest('sendMessage', { chatId, text: `Префикс [${pref}] успешно выдан игроку @${target}!` });
    }
}

// Long Polling Update Loop
let lastUpdateId = 0;
async function pollUpdates() {
    if (!BOT_TOKEN || BOT_TOKEN === 'ВАШ_ТОКЕН_ОТ_BOTFATHER') return;

    try {
        const res = await apiRequest('getUpdates', {
            offset: lastUpdateId + 1,
            timeout: 25
        });

        if (res.ok && Array.isArray(res.result)) {
            for (const upd of res.result) {
                lastUpdateId = upd.update_id;

                if (upd.message && upd.message.text) {
                    const text = upd.message.text.trim();
                    const from = upd.message.from;
                    const chatId = upd.message.chat.id;

                    if (text.startsWith('/start')) {
                        const parts = text.split(' ');
                        const refParam = parts.length > 1 ? parts[1] : null;
                        await sendWelcome(chatId, from, refParam);
                    } else if (text.startsWith('/')) {
                        await handleCommand(chatId, text, from);
                    }
                } else if (upd.callback_query) {
                    const cb = upd.callback_query;
                    const from = cb.from;
                    const chatId = cb.message.chat.id;

                    if (cb.data === 'my_balance') {
                        const db = getDB();
                        const p = db.players[String(from.id)];
                        const real = p ? (p.balance || 0) - (p.creditDebt || 0) : 100;
                        await apiRequest('answerCallbackQuery', {
                            callback_query_id: cb.id,
                            text: `Чистые средства: ${fmtUSD(real)} | Долг: ${fmtUSD(p?.creditDebt || 0)}`,
                            show_alert: true
                        });
                    }
                }
            }
        }
    } catch(e) {
        // network retry
    }

    setTimeout(pollUpdates, 1000);
}

// Запуск бота
if (BOT_TOKEN && BOT_TOKEN !== 'ВАШ_ТОКЕН_ОТ_BOTFATHER') {
    console.log('[BOT] Запуск Telegram бота для LottoDrop...');
    pollUpdates();
} else {
    console.log('[BOT] Бот ожидает BOT_TOKEN. Укажите переменную окружения BOT_TOKEN.');
}

module.exports = { apiRequest, sendWelcome, handleCommand };
