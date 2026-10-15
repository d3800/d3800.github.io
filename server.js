// =================================================================
// LottoDrop Master Server (Node.js)
// Lottery Tickets, Tax System, Loans / Credit, Real Money Leaderboard,
// P2P Currency Fiat Exchange, Telegram Stars Shop (@opcevz), Bans & Prefixes
// =================================================================
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const BOT_TOKEN = process.env.BOT_TOKEN || 'ВАШ_ТОКЕН_ОТ_BOTFATHER';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1190234';
const CREATOR_USERNAME = 'opcevz';

function fmtUSD(val) {
    const num = Number(val || 0);
    return (num < 0 ? '-$' : '$') + Math.abs(num).toFixed(2);
}

// -------------------------------------------------------------
// DATABASE INITIALIZATION & PERSISTENCE
// -------------------------------------------------------------
function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf8');
            const data = JSON.parse(raw);
            return {
                players: data.players || {},           // userId -> player
                p2pListings: data.p2pListings || [],   // Currency P2P listings
                starsOrders: data.starsOrders || [],   // Telegram Stars orders
                promocodes: {
                    'OPCEVZ': { reward: 250.0, tickets: 3 },
                    'LOTTO2026': { reward: 100.0, tickets: 1 },
                    'START777': { reward: 50.0, tickets: 1 },
                    ...(data.promocodes || {})
                }
            };
        }
    } catch (e) {
        console.error('[DB] Ошибка чтения базы данных:', e);
    }
    return {
        players: {},
        p2pListings: [],
        starsOrders: [],
        promocodes: {
            'OPCEVZ': { reward: 250.0, tickets: 3 },
            'LOTTO2026': { reward: 100.0, tickets: 1 },
            'START777': { reward: 50.0, tickets: 1 }
        }
    };
}

function saveDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[DB] Ошибка сохранения базы данных:', e);
    }
}

let db = loadDB();

function findPlayer(target) {
    if (!target) return null;
    const clean = String(target).trim().toLowerCase().replace('@', '');
    if (db.players[clean]) return db.players[clean];
    return Object.values(db.players).find(p => (p.username && p.username.toLowerCase() === clean) || String(p.id) === clean);
}

function sendTelegramMessage(chatId, text) {
    if (!chatId || !BOT_TOKEN || BOT_TOKEN === 'ВАШ_ТОКЕН_ОТ_BOTFATHER') return;

    const payload = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {
        res.on('data', () => {});
    });
    req.on('error', (err) => console.error('[BOT NOTIFY ERROR]:', err.message));
    req.write(payload);
    req.end();
}

function checkPlayerLoanExpiry(player) {
    if (!player || !player.creditDebt || player.creditDebt <= 0) return false;
    if (player.loanDueAt && Date.now() >= player.loanDueAt && !player.loanPenaltyApplied) {
        // 48 hours passed! Penalty increased to +30% total from principal
        // From +15% to +30%: scale remaining debt by (1.30 / 1.15)
        player.creditDebt = Number((player.creditDebt * (1.30 / 1.15)).toFixed(2));
        player.loanPenaltyApplied = true;

        // Force auto-collection from balance!
        // If player has insufficient balance, balance is driven into the NEGATIVE!
        player.balance = Number(((player.balance || 0) - player.creditDebt).toFixed(2));
        const collectedDebt = player.creditDebt;
        player.creditDebt = 0; // Debt converted into negative balance
        player.loanDueAt = null;

        if (player.chatId) {
            sendTelegramMessage(player.chatId, `🚨 *Срок кредита истек (48 ч)!*\n\nБанк принудительно списал долг со штрафом *+30%* (*${fmtUSD(collectedDebt)}*).\nВаш баланс: *${fmtUSD(player.balance)}*!\n_Если баланс отрицательный, он подсвечивается красным!_`);
        }
        return true;
    }
    return false;
}

// -------------------------------------------------------------
// HTTP SERVER & REST API
// -------------------------------------------------------------
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    const jsonRes = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
    };

    const readBody = (callback) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                callback(JSON.parse(body || '{}'));
            } catch (e) {
                jsonRes(400, { error: 'Некорректный JSON формат' });
            }
        });
    };

    // ---------------------------------------------------------
    // 1. LEADERBOARD: Ranked strictly by REAL MONEY (Balance - CreditDebt)
    // ---------------------------------------------------------
    if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
        const playersArray = Object.values(db.players)
            .filter(p => !p.isBanned)
            .map(p => {
                checkPlayerLoanExpiry(p);
                const bal = Number(p.balance || 0);
                const debt = Number(p.creditDebt || 0);
                const realMoney = bal - debt; // Deduct credit debt from real net worth!
                return {
                    id: p.id,
                    name: p.name,
                    username: p.username,
                    realMoney: Number(realMoney.toFixed(2)),
                    balance: Number(bal.toFixed(2)),
                    creditDebt: Number(debt.toFixed(2)),
                    collectionCount: (p.collection || []).length,
                    prefixText: p.prefixText || '',
                    prefixCss: p.prefixCss || ''
                };
            })
            // Rank strictly by REAL NET MONEY!
            .sort((a, b) => b.realMoney - a.realMoney);

        return jsonRes(200, { success: true, players: playersArray });
    }

    // ---------------------------------------------------------
    // 2. PLAYER PROFILE SYNC: Balances, Taxes, Debt, Collection
    // ---------------------------------------------------------
    if (url.pathname === '/api/player/sync' && req.method === 'POST') {
        return readBody((data) => {
            if (!data.id) return jsonRes(400, { error: 'Не указан ID пользователя' });
            const id = String(data.id);

            let player = db.players[id];
            let isNew = false;

            if (!player) {
                isNew = true;
                player = {
                    id: id,
                    chatId: data.chatId || id,
                    name: data.name || 'Игрок',
                    username: (data.username || `user${id}`).replace('@', '').toLowerCase(),
                    balance: typeof data.balance === 'number' ? data.balance : 100.0,
                    creditDebt: typeof data.creditDebt === 'number' ? data.creditDebt : 0.0,
                    taxDue: typeof data.taxDue === 'number' ? data.taxDue : 0.0,
                    ticketsInteracted: typeof data.ticketsInteracted === 'number' ? data.ticketsInteracted : 0,
                    collection: Array.isArray(data.collection) ? data.collection : [],
                    prefixText: '',
                    prefixCss: '',
                    isBanned: false,
                    redeemedCodes: [],
                    lastSeen: Date.now()
                };
                db.players[id] = player;
            } else {
                if (data.name) player.name = data.name;
                if (data.username) player.username = data.username.replace('@', '').toLowerCase();
                if (data.chatId) player.chatId = data.chatId;

                if (!player.isBanned) {
                    if (typeof data.balance === 'number') player.balance = data.balance;
                    if (typeof data.creditDebt === 'number') player.creditDebt = data.creditDebt;
                    if (typeof data.taxDue === 'number') player.taxDue = data.taxDue;
                    if (typeof data.ticketsInteracted === 'number') player.ticketsInteracted = data.ticketsInteracted;
                    if (Array.isArray(data.collection)) player.collection = data.collection;
                }
                player.lastSeen = Date.now();
            }

            // Check 48h loan expiration
            checkPlayerLoanExpiry(player);

            saveDB(db);

            const realMoney = Number(((player.balance || 0) - (player.creditDebt || 0)).toFixed(2));

            return jsonRes(200, {
                success: true,
                player: {
                    id: player.id,
                    name: player.name,
                    username: player.username,
                    balance: player.balance,
                    creditDebt: player.creditDebt,
                    taxDue: player.taxDue,
                    ticketsInteracted: player.ticketsInteracted,
                    realMoney: realMoney,
                    collection: player.collection || [],
                    prefixText: player.prefixText,
                    prefixCss: player.prefixCss,
                    isBanned: player.isBanned,
                    loanDueAt: player.loanDueAt,
                    loanTakenAt: player.loanTakenAt
                }
            });
        });
    }

    // ---------------------------------------------------------
    // 3. CREDIT / LOANS: 48h Term, +15% interest, +30% penalty
    // ---------------------------------------------------------
    if (url.pathname === '/api/credit/take' && req.method === 'POST') {
        return readBody((data) => {
            const { userId, amount } = data;
            const borrowAmt = parseFloat(amount);
            if (!userId || isNaN(borrowAmt) || borrowAmt <= 0) {
                return jsonRes(400, { error: 'Некорректная сумма кредита' });
            }

            const player = findPlayer(userId);
            if (!player) return jsonRes(404, { error: 'Игрок не найден' });
            if (player.isBanned) return jsonRes(403, { error: 'Аккаунт заблокирован' });

            // Check if player has active debt, limit new borrow to not exceed current debt
            const currentDebt = player.creditDebt || 0;
            if (currentDebt > 0 && borrowAmt > currentDebt) {
                return jsonRes(400, {
                    error: `При активном долге сумма нового кредита не может превышать сумму текущего долга (${fmtUSD(currentDebt)})`
                });
            }

            // Loan granted: player receives borrowAmt, debt is +15%
            const debtToAdd = Number((borrowAmt * 1.15).toFixed(2));
            player.balance = Number(((player.balance || 0) + borrowAmt).toFixed(2));
            player.creditDebt = Number((currentDebt + debtToAdd).toFixed(2));
            player.loanTakenAt = Date.now();
            player.loanDueAt = Date.now() + (48 * 3600 * 1000); // 48 Hours deadline!
            player.loanPenaltyApplied = false;

            saveDB(db);

            const realMoney = Number(((player.balance || 0) - (player.creditDebt || 0)).toFixed(2));

            if (player.chatId) {
                sendTelegramMessage(player.chatId, `🏛️ *Кредит одобрен!*\n\nПолучено: *+${fmtUSD(borrowAmt)}*\nК возврату (+15%): *${fmtUSD(debtToAdd)}*\nОбщий долг: *${fmtUSD(player.creditDebt)}*\nСрок возврата: *48 часов*.\n_По истечении 48ч штраф увеличится до +30% и средства спишутся принудительно (баланс может уйти в минус)!_`);
            }

            return jsonRes(200, {
                success: true,
                borrowedAmount: borrowAmt,
                debtAdded: debtToAdd,
                newBalance: player.balance,
                newCreditDebt: player.creditDebt,
                realMoney: realMoney,
                loanDueAt: player.loanDueAt
            });
        });
    }

    if (url.pathname === '/api/credit/repay' && req.method === 'POST') {
        return readBody((data) => {
            const { userId, amount } = data;
            const repayAmt = parseFloat(amount);
            const player = findPlayer(userId);
            if (!player) return jsonRes(404, { error: 'Игрок не найден' });
            if (player.isBanned) return jsonRes(403, { error: 'Аккаунт заблокирован' });

            const currentDebt = player.creditDebt || 0;
            if (currentDebt <= 0) return jsonRes(400, { error: 'У вас нет активного кредита' });

            const actualRepay = Math.min(repayAmt, currentDebt, player.balance || 0);
            if (actualRepay <= 0) return jsonRes(400, { error: 'Недостаточно средств для погашения' });

            player.balance = Number(((player.balance || 0) - actualRepay).toFixed(2));
            player.creditDebt = Number((currentDebt - actualRepay).toFixed(2));

            if (player.creditDebt <= 0) {
                player.creditDebt = 0;
                player.loanDueAt = null;
                player.loanPenaltyApplied = false;
            }

            saveDB(db);

            const realMoney = Number(((player.balance || 0) - (player.creditDebt || 0)).toFixed(2));

            return jsonRes(200, {
                success: true,
                repaidAmount: actualRepay,
                newBalance: player.balance,
                newCreditDebt: player.creditDebt,
                realMoney: realMoney
            });
        });
    }

    // ---------------------------------------------------------
    // 4. TAX SYSTEM: Progressive Tax calculation & payment
    // ---------------------------------------------------------
    if (url.pathname === '/api/tax/pay' && req.method === 'POST') {
        return readBody((data) => {
            const { userId } = data;
            const player = findPlayer(userId);
            if (!player) return jsonRes(404, { error: 'Игрок не найден' });
            if (player.isBanned) return jsonRes(403, { error: 'Аккаунт заблокирован' });

            const tax = player.taxDue || 0;
            if (tax <= 0) return jsonRes(400, { error: 'У вас нет неоплаченного налога' });
            if (player.balance < tax) {
                return jsonRes(400, {
                    error: `Недостаточно средств для уплаты налога (${fmtUSD(tax)}). Вы можете взять кредит в Банке!`
                });
            }

            player.balance = Number(((player.balance || 0) - tax).toFixed(2));
            player.taxDue = 0;
            saveDB(db);

            return jsonRes(200, {
                success: true,
                paidTax: tax,
                newBalance: player.balance,
                newTaxDue: 0
            });
        });
    }

    if (url.pathname === '/api/tax/add' && req.method === 'POST') {
        return readBody((data) => {
            const { userId, ticketEstValue } = data;
            const player = findPlayer(userId);
            if (!player) return jsonRes(404, { error: 'Игрок не найден' });

            player.ticketsInteracted = (player.ticketsInteracted || 0) + 1;
            // Increased progressive tax rate from 10% up to 35%
            const rate = Math.min(0.10 + (player.ticketsInteracted * 0.005), 0.35);
            const addedTax = Number(((ticketEstValue || 50) * rate).toFixed(2));
            player.taxDue = Number(((player.taxDue || 0) + addedTax).toFixed(2));
            saveDB(db);

            return jsonRes(200, {
                success: true,
                addedTax,
                currentRate: Math.round(rate * 100),
                totalTaxDue: player.taxDue,
                interactions: player.ticketsInteracted
            });
        });
    }

    // ---------------------------------------------------------
    // 4.5 DIRECT PLAYER TRANSFERS (@username or ID)
    // ---------------------------------------------------------
    if (url.pathname === '/api/transfer' && req.method === 'POST') {
        return readBody((data) => {
            const { senderId, targetUser, amount } = data;
            const xferAmt = parseFloat(amount);

            if (!senderId || !targetUser || isNaN(xferAmt) || xferAmt <= 0) {
                return jsonRes(400, { error: 'Укажите получателя и корректную сумму перевода (больше 0)' });
            }

            const sender = findPlayer(senderId);
            if (!sender) return jsonRes(404, { error: 'Отправитель не найден' });
            if (sender.isBanned) return jsonRes(403, { error: 'Ваш аккаунт заблокирован' });

            // Check if sender has overdue loan
            checkPlayerLoanExpiry(sender);

            if (sender.balance < xferAmt) {
                return jsonRes(400, {
                    error: `Недостаточно средств. Ваш баланс: ${fmtUSD(sender.balance)}, запрошено: ${fmtUSD(xferAmt)}`
                });
            }

            const recipient = findPlayer(targetUser);
            if (!recipient) {
                return jsonRes(404, {
                    error: `Игрок «${targetUser}» не найден. Убедитесь, что игрок хотя бы раз заходил в игру.`
                });
            }

            if (String(recipient.id) === String(sender.id)) {
                return jsonRes(400, { error: 'Нельзя переводить валюту самому себе!' });
            }

            if (recipient.isBanned) {
                return jsonRes(403, { error: 'Получатель заблокирован администрацией' });
            }

            // Execute transfer
            sender.balance = Number(((sender.balance || 0) - xferAmt).toFixed(2));
            recipient.balance = Number(((recipient.balance || 0) + xferAmt).toFixed(2));
            saveDB(db);

            // Optional Telegram notification to recipient
            if (recipient.chatId) {
                const senderName = sender.username ? `@${sender.username}` : (sender.first_name || `ID ${sender.id}`);
                sendTelegramMessage(recipient.chatId, `💸 *Вам поступил перевод!*\n\nИгрок *${senderName}* перевёл вам *${fmtUSD(xferAmt)}*.\nВаш новый баланс: *${fmtUSD(recipient.balance)}*!`);
            }

            return jsonRes(200, {
                success: true,
                transferredAmount: xferAmt,
                senderBalance: sender.balance,
                recipient: {
                    id: recipient.id,
                    username: recipient.username,
                    first_name: recipient.first_name
                }
            });
        });
    }

    // ---------------------------------------------------------
    // 5. P2P CURRENCY MARKET: Trade in-game $ for real money with limits
    // ---------------------------------------------------------
    if (url.pathname === '/api/p2p/listings' && req.method === 'GET') {
        return jsonRes(200, { success: true, listings: db.p2pListings });
    }

    if (url.pathname === '/api/p2p/list' && req.method === 'POST') {
        return readBody((data) => {
            const { sellerId, amount, pricePerUnit, fiatCurrency, minLimit, maxLimit, paymentMethod } = data;
            const sellAmt = parseFloat(amount);
            const unitPrice = parseFloat(pricePerUnit);
            const minLim = parseFloat(minLimit) || 10;
            const maxLim = parseFloat(maxLimit) || sellAmt;

            if (!sellerId || isNaN(sellAmt) || sellAmt <= 0 || isNaN(unitPrice) || unitPrice <= 0) {
                return jsonRes(400, { error: 'Некорректная сумма или цена' });
            }

            const seller = findPlayer(sellerId);
            if (!seller) return jsonRes(404, { error: 'Продавец не найден' });
            if (seller.isBanned) return jsonRes(403, { error: 'Аккаунт заблокирован' });
            if (seller.balance < sellAmt) {
                return jsonRes(400, { error: 'Недостаточно средств на балансе для выставления лота' });
            }

            // Escrow funds from seller
            seller.balance -= sellAmt;

            const listing = {
                id: Date.now(),
                sellerId: String(seller.id),
                sellerName: `@${seller.username}`,
                sellerTg: `https://t.me/${seller.username}`,
                amount: sellAmt,
                availableAmount: sellAmt,
                pricePerUnit: unitPrice,
                fiatCurrency: fiatCurrency || '₽',
                minLimit: minLim,
                maxLimit: Math.min(maxLim, sellAmt),
                paymentMethod: paymentMethod || 'СБП / Карта',
                createdAt: Date.now()
            };

            db.p2pListings.unshift(listing);
            saveDB(db);

            return jsonRes(200, { success: true, listing, newBalance: seller.balance });
        });
    }

    if (url.pathname === '/api/p2p/buy' && req.method === 'POST') {
        return readBody((data) => {
            const { listingId, buyerId, buyAmount } = data;
            const amt = parseFloat(buyAmount);

            const idx = db.p2pListings.findIndex(l => l.id === listingId);
            if (idx === -1) return jsonRes(404, { error: 'Лот не найден' });

            const listing = db.p2pListings[idx];
            if (String(listing.sellerId) === String(buyerId)) {
                return jsonRes(400, { error: 'Нельзя покупать у самого себя' });
            }

            if (amt < listing.minLimit || amt > listing.availableAmount) {
                return jsonRes(400, {
                    error: `Сумма должна быть от ${listing.minLimit}$ до ${listing.availableAmount}$`
                });
            }

            const buyer = findPlayer(buyerId);
            const seller = findPlayer(listing.sellerId);
            if (!buyer) return jsonRes(404, { error: 'Покупатель не найден' });
            if (buyer.isBanned) return jsonRes(403, { error: 'Аккаунт покупателя заблокирован' });

            // Transfer in-game currency to buyer
            buyer.balance = (buyer.balance || 0) + amt;
            listing.availableAmount -= amt;

            const totalFiat = (amt * listing.pricePerUnit).toFixed(2);

            if (listing.availableAmount <= 0) {
                db.p2pListings.splice(idx, 1);
            }
            saveDB(db);

            // Notify seller in Telegram!
            if (seller && seller.chatId) {
                sendTelegramMessage(seller.chatId, `💸 *P2P Сделка на бирже!*\n\nПокупатель @${buyer.username} выкупил *${fmtUSD(amt)}* за *${totalFiat} ${listing.fiatCurrency}*!\nСпособ: ${listing.paymentMethod}\nСвяжитесь для завершения оплаты: @${buyer.username}`);
            }

            return jsonRes(200, {
                success: true,
                boughtAmount: amt,
                totalFiat,
                fiatCurrency: listing.fiatCurrency,
                newBalance: buyer.balance,
                sellerUsername: seller ? seller.username : 'seller'
            });
        });
    }

    if (url.pathname === '/api/p2p/cancel' && req.method === 'POST') {
        return readBody((data) => {
            const { listingId, sellerId } = data;
            const idx = db.p2pListings.findIndex(l => l.id === listingId && String(l.sellerId) === String(sellerId));
            if (idx === -1) return jsonRes(404, { error: 'Лот не найден' });

            const listing = db.p2pListings[idx];
            const seller = findPlayer(sellerId);
            if (seller) {
                seller.balance = (seller.balance || 0) + listing.availableAmount;
            }

            db.p2pListings.splice(idx, 1);
            saveDB(db);

            return jsonRes(200, { success: true, returnedAmount: listing.availableAmount, newBalance: seller ? seller.balance : 0 });
        });
    }

    // ---------------------------------------------------------
    // 6. TELEGRAM STARS OFFICIAL SHOP (@opcevz)
    // ---------------------------------------------------------
    if (url.pathname === '/api/stars/packages' && req.method === 'GET') {
        const packages = [
            { id: 'pack_starter', name: 'Стартовый Набор', stars: 50, rewardUSD: 250, bonusTickets: 3, badge: 'Популярно' },
            { id: 'pack_lucky', name: 'Счастливчик Недели', stars: 150, rewardUSD: 1000, bonusTickets: 8, badge: 'Выгодно' },
            { id: 'pack_vip', name: 'Золотой Олигарх', stars: 500, rewardUSD: 4500, bonusTickets: 25, badge: 'VIP Клуб' },
            { id: 'pack_jackpot', name: 'Сорви Куш', stars: 1500, rewardUSD: 18000, bonusTickets: 100, badge: 'Максимум' }
        ];
        return jsonRes(200, { success: true, creator: CREATOR_USERNAME, packages });
    }

    if (url.pathname === '/api/stars/order' && req.method === 'POST') {
        return readBody((data) => {
            const { userId, packageId } = data;
            const player = findPlayer(userId);
            if (!player) return jsonRes(404, { error: 'Игрок не найден' });

            const order = {
                id: Date.now(),
                userId: player.id,
                username: player.username,
                packageId,
                status: 'pending',
                createdAt: Date.now()
            };
            db.starsOrders.unshift(order);
            saveDB(db);

            return jsonRes(200, {
                success: true,
                order,
                directCreatorLink: `https://t.me/${CREATOR_USERNAME}?text=Привет!%20Хочу%20купить%20${packageId}%20за%20звёзды%20в%20LottoDrop%20(ID:%20${player.id})`
            });
        });
    }

    // ---------------------------------------------------------
    // 7. PROMOCODES & REWARDS
    // ---------------------------------------------------------
    if (url.pathname === '/api/promo/redeem' && req.method === 'POST') {
        return readBody((data) => {
            const { userId, code } = data;
            const cleanCode = (code || '').trim().toUpperCase();
            const player = findPlayer(userId);

            if (!player) return jsonRes(404, { error: 'Игрок не найден' });
            if (player.isBanned) return jsonRes(403, { error: 'Аккаунт заблокирован' });

            if (!player.redeemedCodes) player.redeemedCodes = [];
            if (player.redeemedCodes.includes(cleanCode)) {
                return jsonRes(400, { error: 'Вы уже активировали этот промокод!' });
            }

            const promo = db.promocodes[cleanCode];
            if (!promo) return jsonRes(404, { error: 'Промокод не существует' });

            player.balance = (player.balance || 0) + promo.reward;
            player.redeemedCodes.push(cleanCode);
            saveDB(db);

            return jsonRes(200, {
                success: true,
                reward: promo.reward,
                tickets: promo.tickets,
                newBalance: player.balance
            });
        });
    }

    // ---------------------------------------------------------
    // 8. ADMIN SYSTEM (PASSWORD 1190234)
    // ---------------------------------------------------------
    if (url.pathname === '/api/admin/auth' && req.method === 'POST') {
        return readBody((data) => {
            if (data.password === ADMIN_PASSWORD) return jsonRes(200, { success: true });
            return jsonRes(401, { error: 'Неверный пароль администратора' });
        });
    }

    if (url.pathname === '/api/admin/money' && req.method === 'POST') {
        return readBody((data) => {
            if (data.password !== ADMIN_PASSWORD) return jsonRes(401, { error: 'Отказано в доступе' });
            const { targetId, amount } = data;
            const player = findPlayer(targetId);
            if (!player) return jsonRes(404, { error: 'Пользователь не найден' });

            player.balance = (player.balance || 0) + parseFloat(amount);
            saveDB(db);
            return jsonRes(200, { success: true, newBalance: player.balance, player });
        });
    }

    if (url.pathname === '/api/admin/prefix' && req.method === 'POST') {
        return readBody((data) => {
            if (data.password !== ADMIN_PASSWORD) return jsonRes(401, { error: 'Отказано в доступе' });
            const { targetId, prefixText, prefixCss } = data;
            const player = findPlayer(targetId);
            if (!player) return jsonRes(404, { error: 'Пользователь не найден' });

            player.prefixText = prefixText || '';
            player.prefixCss = prefixCss || 'bg-amber-900/60 text-amber-300 border border-amber-500/50';
            saveDB(db);
            return jsonRes(200, { success: true, player });
        });
    }

    if (url.pathname === '/api/admin/ban' && req.method === 'POST') {
        return readBody((data) => {
            if (data.password !== ADMIN_PASSWORD) return jsonRes(401, { error: 'Отказано в доступе' });
            const { targetId, isBanned } = data;
            const player = findPlayer(targetId);
            if (!player) return jsonRes(404, { error: 'Пользователь не найден' });

            player.isBanned = Boolean(isBanned);
            saveDB(db);

            if (player.chatId) {
                const banMsg = player.isBanned 
                    ? `⚠️ *Ваш аккаунт в LottoDrop был заблокирован администратором.*\nДля связи напишите @opcevz`
                    : `✅ *Ваш аккаунт в LottoDrop разблокирован.* Приятной игры!`;
                sendTelegramMessage(player.chatId, banMsg);
            }

            return jsonRes(200, { success: true, player });
        });
    }

    if (url.pathname === '/api/admin/players' && req.method === 'GET') {
        const pass = url.searchParams.get('password');
        if (pass !== ADMIN_PASSWORD) return jsonRes(401, { error: 'Отказано в доступе' });

        return jsonRes(200, { success: true, players: Object.values(db.players) });
    }

    // ---------------------------------------------------------
    // 9. STATIC FILE SERVING (WEB APP HTML/CSS/JS)
    // ---------------------------------------------------------
    let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`LottoDrop Lottery Server is running 24/7 on PORT: ${PORT}`);
    console.log(`Creator Support: @${CREATOR_USERNAME}`);
    console.log(`Features: Scratch & TV Lotto | Ticket Tax | Loans/Credit`);
    console.log(`Leaderboard (Net Real Money) | P2P Currency Market | Stars Shop`);
    console.log(`====================================================`);

    if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'ВАШ_ТОКЕН_ОТ_BOTFATHER') {
        try {
            require('./bot.js');
            console.log('[AUTO-START] Telegram Bot успешно запущен вместе с сервером!');
        } catch (err) {
            console.error('[AUTO-START] Ошибка запуска бота:', err);
        }
    }
});
