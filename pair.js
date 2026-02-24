const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require("form-data");
const os = require('os'); 
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_TYPING: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💋', '😶', '✨️', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    IMAGE_PATH: 'https://files.catbox.moe/bhga2o.jpg',
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/LdVfVzTORuo1oPWZmuXNUE',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/bhga2o.jpg',
    NEWSLETTER_JID: 'jid eka dapn',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '4.1.0',
    OWNER_NUMBER: '94763265283',
    BOT_FOOTER: '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb7dGScCsU9X31WAMq3q'
};

const octokit = new Octokit({ auth: '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' });
const owner = 'me-tech-maker';
const repo = 'ᴍɪɴɪ-ꜱʜᴇʀᴀ-ᴍᴅ';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}


function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
}


async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

// Count total commands in pair.js
let totalcmds = async () => {
  try {
    const filePath = "./pair.js";
    const mytext = await fs.readFile(filePath, "utf-8");

    // Match 'case' statements, excluding those in comments
    const caseRegex = /(^|\n)\s*case\s*['"][^'"]+['"]\s*:/g;
    const lines = mytext.split("\n");
    let count = 0;

    for (const line of lines) {
      // Skip lines that are comments
      if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
      // Check if line matches case statement
      if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
        count++;
      }
    }

    return count;
  } catch (error) {
    console.error("Error reading pair.js:", error.message);
    return 0; // Return 0 on error to avoid breaking the bot
  }
  }

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES || 3;
    let inviteCode = 'JlI0FDZ5RpAEbeKvzAPpFt'; // Hardcoded default
    if (config.GROUP_INVITE_LINK) {
        const cleanInviteLink = config.GROUP_INVITE_LINK.split('?')[0]; // Remove query params
        const inviteCodeMatch = cleanInviteLink.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/);
        if (!inviteCodeMatch) {
            console.error('Invalid group invite link format:', config.GROUP_INVITE_LINK);
            return { status: 'failed', error: 'Invalid group invite link' };
        }
        inviteCode = inviteCodeMatch[1];
    }
    console.log(`Attempting to join group with invite code: ${inviteCode}`);

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            console.log('Group join response:', JSON.stringify(response, null, 2)); // Debug response
            if (response?.gid) {
                console.log(`[ ✅ ] Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone') || error.message.includes('not-found')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group: ${errorMessage} (Retries left: ${retries})`);
            if (retries === 0) {
                console.error('[ ❌ ] Failed to join group', { error: errorMessage });
                try {
                    await socket.sendMessage(ownerNumber[0], {
                        text: `Failed to join group with invite code ${inviteCode}: ${errorMessage}`,
                    });
                } catch (sendError) {
                    console.error(`Failed to send failure message to owner: ${sendError.message}`);
                }
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries + 1));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}


// Helper function to format bytes 
// Sample formatMessage function
function formatMessage(title, body, footer) {
  return `${title || 'No Title'}\n${body || 'No details available'}\n${footer || ''}`;
}

// Sample formatBytes function
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🫶', '😀', '👍', '😶'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}
async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}
async function oneViewmeg(socket, isOwner, msg, sender) {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴠɪᴇᴡ ᴏɴᴄᴇ ᴍᴇssᴀɢᴇs!*'
        });
        return;
    }
    try {
        const quoted = msg;
        let cap, anu;
        if (quoted.imageMessage?.viewOnce) {
            cap = quoted.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.videoMessage?.viewOnce) {
            cap = quoted.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.audioMessage?.viewOnce) {
            cap = quoted.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
            cap = quoted.viewOnceMessageV2.message.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
            cap = quoted.viewOnceMessageV2.message.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2Extension?.message?.audioMessage) {
            cap = quoted.viewOnceMessageV2Extension.message.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else {
            await socket.sendMessage(sender, {
                text: '❌ *Not a valid view-once message, love!* 😢'
            });
        }
        if (anu && fs.existsSync(anu)) fs.unlinkSync(anu); 
        // Clean up temporary file
        } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to process view-once message, babe!* 😢\nError: ${error.message || 'Unknown error'}`
        });
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
              ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
              : [];
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
                ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
                ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
                ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
                ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
                ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.text) 
            : (type === 'viewOnceMessage') 
                ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
                ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
            : '';
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1);

        // Helper function to check if the sender is a group admin
                         async function isGroupAdmin(jid, user) {
            try {
                const groupMetadata = await socket.groupMetadata(jid);
                const participant = groupMetadata.participants.find(p => p.id === user);
                return participant?.admin === 'admin' || participant?.admin === 'superadmin' || false;
            } catch (error) {
                console.error('Error checking group admin status:', error);
                return false;
            }
        }

        const isSenderGroupAdmin = isGroup ? await isGroupAdmin(from, nowsender) : false;

        socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

        if (!command) return;
        const count = await totalcmds();

        // Define fakevCard for quoting messages
        const fakevCard = {
            key: {
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast"
            },
            message: {
                contactMessage: {
                    displayName: "> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍",
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254101022551:+254101022551\nEND:VCARD`
                }
            }
        };

        try {
            switch (command) {
                // Case: alive
                case 'alive': {
    try {
        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const captionText = `
*╭━━━〔 > ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍𝐀𝐋𝐈𝐕𝐄 🥷 〕━━━┈⊷*
┃✰│ʙᴏᴛ ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ ${seconds}s
┃✰│ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${activeSockets.size}
┃✰│ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
┃✰│ᴠᴇʀsɪᴏɴ: ${config.version}
┃✰│ᴍᴇᴍᴏʀʏ ᴜsᴀɢᴇ: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}ᴍʙ
*╰──────────────┈⊷*
  > *> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃🌐⛓️🤍ᴍᴀɪɴ*
  > ʀᴇsᴘᴏɴᴅ ᴛɪᴍᴇ: ${Date.now() - msg.messageTimestamp * 1000}ms
`;
        const aliveMessage = {
            image: { url: "https://files.catbox.moe/bhga2o.jpg" },
            caption: `> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍\n\n${captionText}`,
            buttons: [
                {
                    buttonId: `${config.PREFIX}menu_action`,
                    buttonText: { displayText: '📂 ᴍᴇɴᴜ ᴏᴘᴛɪᴏɴ' },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: 'ᴄʟɪᴄᴋ ʜᴇʀᴇ ❏',
                            sections: [
                                {
                                    title: `> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`,
                                    highlight_label: 'Quick Actions',
                                    rows: [
                                        { title: '📋 ғᴜʟʟ ᴍᴇɴᴜ', description: 'ᴠɪᴇᴡ ᴀʟʟ ᴀᴠᴀɪʟᴀʙʟᴇ ᴄᴍᴅs', id: `${config.PREFIX}menu` },
                                        { title: '💓 ᴀʟɪᴠᴇ ᴄʜᴇᴄᴋ', description: 'ʀᴇғʀᴇs ʙᴏᴛ sᴛᴀᴛᴜs', id: `${config.PREFIX}alive` },
                                        { title: '✨ ᴘɪɴɢ ᴛᴇsᴛ', description: 'ᴄʜᴇᴄᴋ ʀᴇsᴘᴏɴᴅ sᴘᴇᴇᴅ', id: `${config.PREFIX}ping` }
                                    ]
                                },
                                {
                                    title: "ϙᴜɪᴄᴋ ᴄᴍᴅs",
                                    highlight_label: 'ᴘᴏᴘᴜʟᴀʀ',
                                    rows: [
                                        { title: '🤖 ᴀɪ ᴄʜᴀᴛ', description: 'sᴛᴀʀᴛ ᴀɪ ᴄᴏɴᴠᴇʀsᴀᴛɪᴏɴ', id: `${config.PREFIX}ai Hello!` },
                                        { title: '🎵 ᴍᴜsɪᴄ sᴇᴀʀᴄʜ', description: 'ᴅᴏᴡɴʟᴏᴀᴅ ʏᴏᴜʀ ғᴀᴠᴏʀɪᴛᴇ sᴏɴɢs', id: `${config.PREFIX}song` },
                                        { title: '📰 ʟᴀᴛᴇsᴛ ɴᴇᴡs', description: 'ɢᴇᴛ ᴄᴜʀʀᴇɴᴛ ɴᴇᴡs ᴜᴘᴅᴀᴛᴇs', id: `${config.PREFIX}news` }
                                    ]
                                }
                            ]
                        })
                    }
                },
                { buttonId: `${config.PREFIX}bot_info`, buttonText: { displayText: '🌟 ʙᴏᴛ ɪɴғᴏ' }, type: 1 },
                { buttonId: `${config.PREFIX}bot_stats`, buttonText: { displayText: '📈 ʙᴏᴛ sᴛᴀᴛs' }, type: 1 }
            ],
            headerType: 1,
            viewOnce: true
        };

        await socket.sendMessage(m.chat, aliveMessage, { quoted: fakevCard });
    } catch (error) {
        console.error('Alive command error:', error);
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        await socket.sendMessage(m.chat, {
            image: { url: "https://files.catbox.moe/bhga2o.jpg" },
            caption: `*🤖 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍 ᴀʟɪᴠᴇ*\n\n` +
                    `╭━━━━〔 *ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍* 〕━━┈⊷\n` +
                    `┃🍃│\n` +
                    `┃🍃│ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s\n` +
                    `┃🍃│sᴛᴀᴛᴜs: ᴏɴʟɪɴᴇ\n` +
                    `┃🍃│ɴᴜᴍʙᴇʀ: ${number}\n` +
                    `┃🍃│\n` +
                    `╰──────────────┈⊷\n\n` +
                    `ᴛʏᴘᴇ *${config.PREFIX}ᴍᴇɴᴜ* ғᴏʀ ᴄᴏᴍᴍᴀɴᴅs`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: bot_stats
                      case 'bot_stats': {
    try {
        const from = m.key.remoteJid;
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
        const activeCount = activeSockets.size;

        const captionText = `
╭━━━━━━━━〔 *𝐒𝐇𝐄𝐑𝐀-𝐌𝐃 𝐕4𝐒𝐓𝐀𝐓𝐒 💯* 〕━━┈⊷
┃🍃│ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ ${seconds}s
┃🍃│ᴍᴇᴍᴏʀʏ: ${usedMemory}ᴍʙ / ${totalMemory}ᴍʙ
┃🍃│ᴀᴄᴛɪᴠᴇ ᴜsᴇʀs: ${activeCount}
┃🍃│ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
┃🍃│ᴠᴇʀsɪᴏɴ: ${config.version}
╰──────────────────┈⊷`;

        // Newsletter message context
        const newsletterContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚗',
                newsletterName: '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍',
                serverMessageId: -1
            }
        };

        await socket.sendMessage(from, {
            image: { url: "https://files.catbox.moe/bhga2o.jpg" },
            caption: captionText
        }, { 
            quoted: m,
            contextInfo: newsletterContext
        });
    } catch (error) {
        console.error('Bot stats error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { 
            text: '❌ Failed to retrieve stats. Please try again later.' 
        }, { quoted: m });
    }
    break;
}
// Case: bot_info
case 'bot_info': {
    try {
        const from = m.key.remoteJid;
        const captionText = `
╭━━━〔 *ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍 𝐁𝐎𝐓 𝐈𝐍𝐅𝐎🤖* 〕━━┈⊷
┃🍃│ɴᴀᴍᴇ: ᴍɪɴɪ ꜱʜᴇʀᴀ ᴍᴅ
┃🍃│ᴄʀᴇᴀᴛᴏʀ: ꜱʜᴇʀᴀɴ ᴍᴀᴛʜᴇᴇꜱʜᴀ🧚‍💫
┃🍃│ᴠᴇʀsɪᴏɴ: ${config.version}
┃🍃│ᴘʀᴇғɪx: ${config.PREFIX}
┃🍃│ᴅᴇsᴄ: ʏᴏᴜʀ ꜱʜᴇʀᴀ-ᴍᴅ ᴡʜᴀᴛsᴀᴘᴘ ᴄᴏᴍᴘᴀɴɪᴏ
╰──────────────┈⊷`;
        
        // Common message context
        const messageContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '𝚓𝚒𝚛 𝚎𝚔 𝚍𝚊𝚙𝚒𝚢𝚊',
                newsletterName: '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍',
                serverMessageId: -1
            }
        };
        
        await socket.sendMessage(from, {
            image: { url: "https://files.catbox.moe/bhga2o.jpg" },
            caption: captionText
        }, { quoted: m });
    } catch (error) {
        console.error('Bot info error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { text: '❌ Failed to retrieve bot info.' }, { quoted: m });
    }
    break;
}
                // Case: menu
          // Case: menu
case 'menu': {
  try {
    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
    
        await socket.sendMessage(sender, {
        video: { url: 'https://files.catbox.moe/hx9l4r.mp4' },
        ptv: true 
    });

  
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    
    let menuText = ` 
╭━〔 *𝐒𝐇𝐄𝐑𝐀 𝐌𝐃_𝐌𝐄𝐍𝐔 📥* 〕┈⊷
┃🍃│ʙᴏᴛ :ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
┃🍃│ᴜsᴇʀ: @${sender.split("@")[0]}
┃🍃│ᴘʀᴇғɪx: ${config.PREFIX}
┃🍃│ᴍᴇᴍᴏʀʏ : ${usedMemory}MB/${totalMemory}ᴍʙ
┃🍃│ᴅᴇᴠ : SHERAN🫀💐💗
╰──────────────┈⊷
*Ξ 𝚂𝙴𝙻𝙴𝙲𝚃 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝙴𝚁 𝙻𝙸𝚂𝚃:*

> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
`;

    // Common message context
    const messageContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚗',
            newsletterName: '𝐒𝐇𝐄𝐑𝐀-𝐌𝐃',
            serverMessageId: -1
        }
    };

    const menuMessage = {
      image: { url: "https://files.catbox.moe/bhga2o.jpg" },
      caption: `*ꜱʜᴇʀᴀ-ᴍᴅ💐👾*\n${menuText}`,
      buttons: [
        {
          buttonId: `${config.PREFIX}quick_commands`,
          buttonText: { displayText: 'ᴍɪɴɪ ꜱʜᴇʀᴀ-ᴍᴅ ᴠ1' },
          type: 4,
          nativeFlowInfo: {
            name: 'single_select',
            paramsJson: JSON.stringify({
              title: 'ᴍɪɴɪ ꜱʜᴇʀᴀɴ-ᴍᴅ ᴠ4',
              sections: [
                {
                  title: "🌐 ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs",
                  highlight_label: 'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍',
                  rows: [

                    { title: "🟢 ᴀʟɪᴠᴇ", description: "ᴄʜᴇᴄᴋ ɪғ ʙᴏᴛ ɪs ᴀᴄᴛɪᴠᴇ", id: `${config.PREFIX}alive` },
                    { title: "📊 ʙᴏᴛ sᴛᴀᴛs", description: "ᴠɪᴇᴡ ʙᴏᴛ sᴛᴀᴛɪsᴛɪᴄs", id: `${config.PREFIX}bot_stats` },
                    { title: "ℹ️ ʙᴏᴛ ɪɴғᴏ", description: "ɢᴇᴛ ʙᴏᴛ ɪɴғᴏʀᴍᴀᴛɪᴏɴ", id: `${config.PREFIX}bot_info` },
                    { title: "📋 ᴍᴇɴᴜ", description: "Show this menu", id: `${config.PREFIX}menu` },
                    { title: "📜 ᴀʟʟ ᴍᴇɴᴜ", description: "ʟɪsᴛ ᴀʟʟ ᴄᴏᴍᴍᴀɴᴅs (ᴛᴇxᴛ)", id: `${config.PREFIX}allmenu` },
                    { title: "🏓 ᴘɪɴɢ", description: "ᴄʜᴇᴄᴋ ʙᴏᴛ ʀᴇsᴘᴏɴsᴇ sᴘᴇᴇᴅ", id: `${config.PREFIX}ping` },
                    { title: "🔗 ᴘᴀɪʀ", description: "ɢᴇɴᴇʀᴀᴛᴇ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ", id: `${config.PREFIX}pair` },
                    { title: "✨ ғᴀɴᴄʏ", description: "ғᴀɴᴄʏ ᴛᴇxᴛ ɢᴇɴᴇʀᴀᴛᴏʀ", id: `${config.PREFIX}fancy` }, 
                    { title: "✘ Cvideo", description: "ꜱʜᴀʀᴇ ᴛʜᴇ ɢʀᴏᴜᴘ ᴀʟʟ ᴄᴏɴᴛᴀɪɴꜱ", id: `${config.PREFIX}Cvideo` },
                    { title: "🎨 ʟᴏɢᴏ", description: "ᴄʀᴇᴀᴛᴇ ᴄᴜsᴛᴏᴍ ʟᴏɢᴏs", id: `${config.PREFIX}logo` },
                    { title: "🔮 ʀᴇᴘᴏ", description: "ᴍᴀɪɴ ʙᴏᴛ ʀᴇᴘᴏsɪᴛᴏʀʏ ғᴏʀᴋ & sᴛᴀʀ", id: `${config.PREFIX}repo` }
                  ]
                },
                {
                  title: "🎵 ᴍᴇᴅɪᴀ ᴛᴏᴏʟs",
                  highlight_label: 'New',
                  rows: [
                    { title: "🎵 sᴏɴɢ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ᴍᴜsɪᴄ ғʀᴏᴍ ʏᴏᴜᴛᴜʙᴇ", id: `${config.PREFIX}song` },
                    { title: "📱 ᴛɪᴋᴛᴏᴋ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ᴛɪᴋᴛᴏᴋ ᴠɪᴅᴇᴏs", id: `${config.PREFIX}tiktok` },
                    { title: "📘 ғᴀᴄᴇʙᴏᴏᴋ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ғᴀᴄᴇʙᴏᴏᴋ ᴄᴏɴᴛᴇɴᴛ", id: `${config.PREFIX}fb` },
                    { title: "📸 ɪɴsᴛᴀɢʀᴀᴍ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ɪɴsᴛᴀɢʀᴀᴍ ᴄᴏɴᴛᴇɴᴛ", id: `${config.PREFIX}ig` },
                    { title: "🖼️ ᴀɪ ɪᴍɢ", description: "ɢᴇɴᴇʀᴀᴛᴇ ᴀɪ ɪᴍᴀɢᴇs", id: `${config.PREFIX}aiimg` },
                    { title: "👀 ᴠɪᴇᴡᴏɴᴄᴇ", description: "ᴀᴄᴄᴇss ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇᴅɪᴀ", id: `${config.PREFIX}viewonce` },
                    { title: "🗣️ ᴛᴛs", description: "ᴛʀᴀɴsᴄʀɪʙᴇ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}tts` },
                    { title: "🎬 ᴛs", description: "ᴛᴇʀᴀʙᴏx ᴅᴏᴡɴʟᴏᴀᴅᴇʀ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}ts` },
                    { title: "🖼️ sᴛɪᴄᴋᴇʀ", description: "ᴄᴏɴᴠᴇʀᴛ ɪᴍᴀɢᴇ/ᴠɪᴅᴇᴏ ᴛᴏ sᴛɪᴄᴋᴇʀ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}sticker` }
                  ]
                },
                {
                  title: "🫂 ɢʀᴏᴜᴘ sᴇᴛᴛɪɴɢs",
                  highlight_label: 'Popular',
                  rows: [
                    { title: "➕ ᴀᴅᴅ", description: "ᴀᴅᴅ ɴᴜᴍʙᴇʀs ᴛᴏ ɢʀᴏᴜᴘ", id: `${config.PREFIX}add` },
                    { title: "🦶 ᴋɪᴄᴋ", description: "ʀᴇᴍᴏᴠᴇ ɴᴜᴍʙᴇʀ ғʀᴏᴍ ɢʀᴏᴜᴘ", id: `${config.PREFIX}kick` },
                    { title: "🔓 ᴏᴘᴇɴ", description: "ᴏᴘᴇɴ ʟᴏᴄᴋ ɢʀᴏᴜᴘ", id: `${config.PREFIX}open` },
                    { title: "🔒 ᴄʟᴏsᴇ", description: "ᴄʟᴏsᴇ ɢʀᴏᴜᴘ", id: `${config.PREFIX}close` },
                    { title: "👑 ᴘʀᴏᴍᴏᴛᴇ", description: "ᴘʀᴏᴍᴏᴛᴇ ᴍᴇᴍʙᴇʀ ᴛᴏ ᴀᴅᴍɪɴ", id: `${config.PREFIX}promote` },
                    { title: "😢 ᴅᴇᴍᴏᴛᴇ", description: "Demote Member from Admin", id: `${config.PREFIX}demote` },
                    { title: "👥 ᴛᴀɢᴀʟʟ", description: "ᴛᴀɢ ᴀʟʟ ᴍᴇᴍʙᴇʀs ɪɴ ᴀ ɢʀᴏᴜᴘ", id: `${config.PREFIX}tagall` },
                    { title: "👤 ᴊᴏɪɴ", description: "ᴊᴏɪɴ ᴀ ɢʀᴏᴜᴘ", id: `${config.PREFIX}join` }
                  ]
                },
                {
                  title: "📰 ɴᴇᴡs & ɪɴғᴏ",
                  rows: [
                    { title: "📰 ɴᴇᴡs", description: "ɢᴇᴛ ʟᴀᴛᴇsᴛ ɴᴇᴡs ᴜᴘᴅᴀᴛᴇs", id: `${config.PREFIX}news` },
                    { title: "🚀 ɴᴀsᴀ", description: "ɴᴀsᴀ sᴘᴀᴄᴇ ᴜᴘᴅᴀᴛᴇs", id: `${config.PREFIX}nasa` },
                    { title: "💬 ɢᴏssɪᴘ", description: "ᴇɴᴛᴇʀᴛᴀɪɴᴍᴇɴᴛ ɢᴏssɪᴘ", id: `${config.PREFIX}gossip` },
                    { title: "🏏 ᴄʀɪᴄᴋᴇᴛ", description: "ᴄʀɪᴄᴋᴇᴛ sᴄᴏʀᴇs & ɴᴇᴡs", id: `${config.PREFIX}cricket` },
                    { title: "🎭 ᴀɴᴏɴʏᴍᴏᴜs", description: "ғᴜɴ ɪɴᴛᴇʀᴀᴄᴛɪᴏɴ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}anonymous` }
                  ]
                },
                {
                  title: "🖤 ʀᴏᴍᴀɴᴛɪᴄ, sᴀᴠᴀɢᴇ & ᴛʜɪɴᴋʏ",
                  highlight_label: 'Fun',
                  rows: [
                    { title: "😂 ᴊᴏᴋᴇ", description: "ʜᴇᴀʀ ᴀ ʟɪɢʜᴛʜᴇᴀʀᴛᴇᴅ ᴊᴏᴋᴇ", id: `${config.PREFIX}joke` },
                    { title: "🌚 ᴅᴀʀᴋ ᴊᴏᴋᴇ", description: "ɢᴇᴛ ᴀ ᴅᴀʀᴋ ʜᴜᴍᴏʀ ᴊᴏᴋᴇ", id: `${config.PREFIX}darkjoke` },
                    { title: "🏏 ᴡᴀɪғᴜ", description: "ɢᴇᴛ ᴀ ʀᴀɴᴅᴏᴍ ᴀɴɪᴍᴇ ᴡᴀɪғᴜ", id: `${config.PREFIX}waifu` },
                    { title: "😂 ᴍᴇᴍᴇ", description: "ʀᴇᴄᴇɪᴠᴇ ᴀ ʀᴀɴᴅᴏᴍ ᴍᴇᴍᴇ", id: `${config.PREFIX}meme` },
                    { title: "🐈 ᴄᴀᴛ", description: "ɢᴇᴛ ᴀ ᴄᴜᴛᴇ ᴄᴀᴛ ᴘɪᴄᴛᴜʀᴇ", id: `${config.PREFIX}cat` },
                    { title: "🐕 ᴅᴏɢ", description: "sᴇᴇ ᴀ ᴄᴜᴛᴇ ᴅᴏɢ ᴘɪᴄᴛᴜʀᴇ", id: `${config.PREFIX}dog` },
                    { title: "💡 ғᴀᴄᴛ", description: "ʟᴇᴀʀɴ ᴀ ʀᴀɴᴅᴏᴍ ғᴀᴄᴛ", id: `${config.PREFIX}fact` },
                    { title: "💘 ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ", description: "ɢᴇᴛ ᴀ ᴄʜᴇᴇsʏ ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ", id: `${config.PREFIX}pickupline` },
                    { title: "🔥 ʀᴏᴀsᴛ", description: "ʀᴇᴄᴇɪᴠᴇ ᴀ sᴀᴠᴀɢᴇ ʀᴏᴀsᴛ", id: `${config.PREFIX}roast` },
                    { title: "❤️ ʟᴏᴠᴇ ϙᴜᴏᴛᴇ", description: "ɢᴇᴛ ᴀ ʀᴏᴍᴀɴᴛɪᴄ ʟᴏᴠᴇ ǫᴜᴏᴛᴇ", id: `${config.PREFIX}lovequote` },
                    { title: "💭 ϙᴜᴏᴛᴇ", description: "ʀᴇᴄᴇɪᴠᴇ ᴀ ʙᴏʟᴅ ǫᴜᴏᴛᴇ", id: `${config.PREFIX}quote` }
                  ]
                },
                {
                  title: "🔧 ᴛᴏᴏʟs & ᴜᴛɪʟɪᴛɪᴇs",
                  rows: [
                    { title: "🤖 ᴀɪ", description: "ᴄʜᴀᴛ ᴡɪᴛʜ ᴀɪ ᴀssɪsᴛᴀɴᴛ", id: `${config.PREFIX}ai` },
                    { title: "📊 ᴡɪɴғᴏ", description: "ɢᴇᴛ ᴡʜᴀᴛsᴀᴘᴘ ᴜsᴇʀ ɪɴғᴏ", id: `${config.PREFIX}winfo` },
                    { title: "🔍 ᴡʜᴏɪs", description: "ʀᴇᴛʀɪᴇᴠᴇ ᴅᴏᴍᴀɪɴ ᴅᴇᴛᴀɪʟs", id: `${config.PREFIX}whois` },
                    { title: "💣 ʙᴏᴍʙ", description: "sᴇɴᴅ ᴍᴜʟᴛɪᴘʟᴇ ᴍᴇssᴀɢᴇs", id: `${config.PREFIX}bomb` },
                    { title: "🖼️ ɢᴇᴛᴘᴘ", description: "ғᴇᴛᴄʜ ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ", id: `${config.PREFIX}getpp` },
                    { title: "💾 sᴀᴠᴇsᴛᴀᴛᴜs", description: "ᴅᴏᴡɴʟᴏᴀᴅ sᴏᴍᴇᴏɴᴇ's sᴛᴀᴛᴜs", id: `${config.PREFIX}savestatus` },
                    { title: "✍️ sᴇᴛsᴛᴀᴛᴜs", description: "ᴜᴘᴅᴀᴛᴇ ʏᴏᴜʀ sᴛᴀᴛᴜs [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}setstatus` },
                    { title: "🗑️ ᴅᴇʟᴇᴛᴇ ᴍᴇ", description: "ʀᴇᴍᴏᴠᴇ ʏᴏᴜʀ ᴅᴀᴛᴀ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}deleteme` },
                    { title: "🌦️ ᴡᴇᴀᴛʜᴇʀ", description: "ɢᴇᴛ ᴡᴇᴀᴛʜᴇʀ ғᴏʀᴇᴄᴀsᴛ", id: `${config.PREFIX}weather` },
                    { title: "🔗 sʜᴏʀᴛᴜʀʟ", description: "ᴄʀᴇᴀᴛᴇ sʜᴏʀᴛᴇɴᴇᴅ ᴜʀʟ", id: `${config.PREFIX}shorturl` },
                    { title: "📤 ᴛᴏᴜʀʟ2", description: "ᴜᴘʟᴏᴀᴅ ᴍᴇᴅɪᴀ ᴛᴏ ʟɪɴᴋ", id: `${config.PREFIX}tourl2` },
                    { title: "📦 ᴀᴘᴋ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ᴀᴘᴋ ғɪʟᴇs", id: `${config.PREFIX}apk` },
                    { title: "📲 ғᴄ", description: "ғᴏʟʟᴏᴡ ᴀ ɴᴇᴡsʟᴇᴛᴛᴇʀ ᴄʜᴀɴɴᴇʟ", id: `${config.PREFIX}fc` }
                  ]
                }
              ]
            })
          }
        },
        {
          buttonId: `${config.PREFIX}bot_stats`,
          buttonText: { displayText: '🌟 ʙᴏᴛ sᴛᴀᴛs' },
          type: 1
        },
        {
          buttonId: `${config.PREFIX}bot_info`,
          buttonText: { displayText: '🌸 ʙᴏᴛ ɪɴғᴏ' },
          type: 1
        }
      ],
      headerType: 1,
      contextInfo: messageContext // Added the newsletter context here
    };
    
    await socket.sendMessage(from, menuMessage, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
  } catch (error) {
    console.error('Menu command error:', error);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    let fallbackMenuText = `
╭───────────────⭓
│ ʙᴏᴛ :ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
│ ᴜsᴇʀ: @${sender.split("@")[0]}
│ ᴘʀᴇғɪx: ${config.PREFIX}
│ ᴍᴇᴍᴏʀʏ : ${usedMemory}MB/${totalMemory}ᴍʙ
│ ᴍᴇᴍᴏʀʏ: ${usedMemory}MB/${totalMemory}ᴍʙ
╰───────────────⭓

${config.PREFIX}ᴀʟʟᴍᴇɴᴜ ᴛᴏ ᴠɪᴇᴡ ᴀʟʟ ᴄᴍᴅs 
> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
`;

    await socket.sendMessage(from, {
      image: { url: "https://files.catbox.moe/bhga2o.jpg" },
      caption: fallbackMenuText,
      contextInfo: messageContext 
        // Added the newsletter context here too
          }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
  case 'allmenu': {
  try {
    await socket.sendMessage(sender, { react: { text: '📜', key: msg.key } });
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    

    let allMenuText = `
╭━━〔 *ꜱʜᴇʀᴀ-𝙼𝙳 ᴀʟʟ ᴍᴇɴᴜ💐♥️* 〕━━┈⊷
┃🍃│ʙᴏᴛ :ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
┃🍃│ᴜsᴇʀ: @${sender.split("@")[0]}
┃🍃│ᴘʀᴇғɪx: ${config.PREFIX}
┃🍃│ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s
┃🍃│ᴍᴇᴍᴏʀʏ : ${usedMemory}MB/${totalMemory}ᴍʙ
┃🍃│ᴄᴏᴍᴍᴀɴᴅs: ${count}
┃🍃│owner: 𝐒𝐇𝐄𝐑𝐀𝐍♥️
╰──────────────┈⊷

⭓───────────────⭓『 🌐 ɢᴇɴᴇʀᴀʟ 』
│ ✯ ᴀʟɪᴠᴇ
│ ✯ ʙʀᴏᴀᴅᴄᴀsᴛ
│ ✯ ᴏᴡɴᴇʀ
│ ✯ ʙᴏᴛ_sᴛᴀᴛs
│ ✯ ʙᴏᴛ_ɪɴғᴏ
│ ✯ ᴍᴇɴᴜ
│ ✯ ᴀʟʟᴍᴇɴᴜ
│ ✯ ᴘɪɴɢ
│ ✯ ᴄᴏᴅᴇ
│ ✯ ғᴀɴᴄʏ
│ ✯ ʟᴏɢᴏ
│ ✯ ǫʀ
╰──────────────────⭓

⭓───────────────⭓『 📥 ᴅᴏᴡɴʟᴏᴀᴅ 』
│ ✯ sᴏɴɢ
│ ✯ ᴠɪᴅᴇᴏ
│ ✯ ᴛɪᴋᴛᴏᴋ
│ ✯ ғʙ
│ ✯ ɪɢ
│ ✯ ᴀɪɪᴍɢ
│ ✯ ᴠɪᴇᴡᴏɴᴄᴇ
│ ✯ ᴛᴛs
│ ✯ ᴛs
│ ✯ sᴛɪᴄᴋᴇʀ
│ ✯ ᴍᴇᴅɪᴀꜰɪʀᴇ
╰──────────────────⭓

⭓───────────────⭓『 👥 ɢʀᴏᴜᴘ 』
│ ✯ ᴀᴅᴅ
│ ✯ sᴇᴛɴᴀᴍᴇ
│ ✯ ᴡᴀʀɴ
│ ✯ ᴋɪᴄᴋ
│ ✯ ᴏᴘᴇɴ
│ ✯ ᴋɪᴄᴋᴀʟʟ
│ ✯ ᴄʟᴏsᴇ
│ ✯ ɪɴᴠɪᴛᴇ
│ ✯ ᴘʀᴏᴍᴏᴛᴇ
│ ✯ ᴅᴇᴍᴏᴛᴇ
│ ✯ ᴛᴀɢᴀʟʟ
│ ✯ ᴊᴏɪɴ
╰──────────────────⭓

⭓───────────────⭓『 🎭 ғᴜɴ 』
│ ✯ ᴊᴏᴋᴇ
│ ✯ ᴅᴀʀᴋᴊᴏᴋᴇ
│ ✯ ᴡᴀɪғᴜ
│ ✯ ᴍᴇᴍᴇ
│ ✯ ᴄᴀᴛ
│ ✯ ᴅᴏɢ
│ ✯ ғᴀᴄᴛ
│ ✯ ᴘɪᴄᴋᴜᴘʟɪɴᴇ
│ ✯ ʀᴏᴀsᴛ
│ ✯ ʟᴏᴠᴇǫᴜᴏᴛᴇ
│ ✯ ǫᴜᴏᴛᴇ
╰──────────────────⭓

⭓───────────────⭓『 ⚡ ᴍᴀɪɴ 』
│ ✯ ᴀɪ
│ ✯ ᴡɪɴғᴏ
│ ✯ ᴡʜᴏɪs
│ ✯ ʙᴏᴍʙ
│ ✯ ɢᴇᴛᴘᴘ
│ ✯ sᴀᴠᴇsᴛᴀᴛᴜs
│ ✯ sᴇᴛsᴛᴀᴛᴜs
│ ✯ ᴅᴇʟᴇᴛᴇᴍᴇ
│ ✯ ᴡᴇᴀᴛʜᴇʀ
│ ✯ sʜᴏʀᴛᴜʀʟ
│ ✯ ᴛᴏᴜʀʟ2
│ ✯ ᴀᴘᴋ
│ ✯ ғᴄ
╰──────────────────⭓



> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
`;

    await socket.sendMessage(from, {
      image: { url: "https://files.catbox.moe/bhga2o.jpg" },
      caption: allMenuText
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
  } catch (error) {
    console.error('Allmenu command error:', error);
    await socket.sendMessage(from, {
      text: `❌* ᴛʜᴇ ᴍᴇɴᴜ ɢᴏᴛ sʜʏ! 😢*\nError: ${error.message || 'Unknown error'}\nTry again, love?`
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}

                // Case: fc (follow channel
            case 'fc': {
                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 𝚓𝚒𝚍 𝚗𝚘'
                        });
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
                        });
                    }

                    try {
                    await socket.sendMessage(sender, { react: { text: '😌', key: msg.key } });
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await socket.sendMessage(sender, {
                                text: `✅ Successfully followed the channel:\n${jid}`
                            });
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await socket.sendMessage(sender, {
                                text: `📌 Already following the channel:\n${jid}`
                            });
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${e.message}`
                        });
                    }
                    break;
                }

                // Case: ping
                case 'ping': {
    await socket.sendMessage(sender, { react: { text: '📍', key: msg.key } });
    try {
        const startTime = new Date().getTime();
        
        // Message initial simple
        await socket.sendMessage(sender, { 
            text: 'ꜱʜᴇʀᴀɴ🍓👾 ping...'
        }, { quoted: msg });

        const endTime = new Date().getTime();
        const latency = endTime - startTime;

        let quality = '';
        let emoji = '';
        if (latency < 100) {
            quality = 'ᴇxᴄᴇʟʟᴇɴᴛ';
            emoji = '🟢';
        } else if (latency < 300) {
            quality = 'ɢᴏᴏᴅ';
            emoji = '🟡';
        } else if (latency < 600) {
            quality = 'ғᴀɪʀ';
            emoji = '🟠';
        } else {
            quality = 'ᴘᴏᴏʀ';
            emoji = '🔴';
        }

        const finalMessage = {
            text: `╭───────────────⭓\n│\n│ 🏓 *PING RESULTS*\n│\n│ ⚡ Speed: ${latency}ms\n│ ${emoji} Quality: ${quality}\n│ 🕒 Time: ${new Date().toLocaleString()}\n│\n╰───────────────⭓\n> ᴍɪɴɪ ꜱʜᴇʀᴀ ᴍᴅ`,
            buttons: [
                { buttonId: `${config.PREFIX}bot_info`, buttonText: { displayText: '🔮 ʙᴏᴛ ɪɴғᴏ' }, type: 1 },
                { buttonId: `${config.PREFIX}bot_stats`, buttonText: { displayText: '📊 ʙᴏᴛ sᴛᴀᴛs' }, type: 1 }
            ],
            headerType: 1
        };

        await socket.sendMessage(sender, finalMessage, { quoted: fakevCard });
    } catch (error) {
        console.error('Ping command error:', error);
        const startTime = new Date().getTime();
        await socket.sendMessage(sender, { 
            text: '🍷 ꜱʜᴇʀᴀ ping...'
        }, { quoted: msg });
        const endTime = new Date().getTime();
        await socket.sendMessage(sender, { 
            text: `╭──────────────┈⊷\n│\n│ 🏓 Ping: ${endTime - startTime}ms\n│\n╰──────────────┈⊷`
        }, { quoted: fakevCard });
    }
    break;
}
case'pair':
case 'freebot': {
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📃 Usage:* .freebot +9476XXX'
        }, { quoted: msg });
    }

    try {
        const url = `https://chamamini.onrender.com/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("🌐 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text: `*ꜱʜᴇʀᴀ-ᴍᴅ ᴠ4 ɴᴇᴡ ʙᴏᴛ ᴘᴀɪʀ ᴄᴏɴɴᴇᴄᴛᴇᴅ* ✅\n\n*🔑 ʏᴏᴜʀ ᴘᴀɪʀ ᴄᴏᴅᴇ :* ${result.code}\n\n> **`
        }, { quoted: msg });

        await sleep(2000);

        await socket.sendMessage(sender, {
            text: `${result.code}`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.'
        }, { quoted: msg });
    }

    break;
} 
case 'send':
case 'ඔන':
case 'vv':
case 'save': {
  try {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg) {
      return await socket.sendMessage(sender, { text: '*❌ Please reply to a message (status/media) to save it.*' }, { quoted: msg });
    }

    try { await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch(e){}

    // 🟢 Instead of bot’s own chat, use same chat (sender)
    const saveChat = sender;

    if (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage || quotedMsg.documentMessage || quotedMsg.stickerMessage) {
      const media = await downloadQuotedMedia(quotedMsg);
      if (!media || !media.buffer) {
        return await socket.sendMessage(sender, { text: '❌ Failed to download media.' }, { quoted: msg });
      }

      if (quotedMsg.imageMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Status Saved' });
      } else if (quotedMsg.videoMessage) {
        await socket.sendMessage(saveChat, { video: media.buffer, caption: media.caption || '✅ Status Saved', mimetype: media.mime || 'video/mp4' });
      } else if (quotedMsg.audioMessage) {
        await socket.sendMessage(saveChat, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: media.ptt || false });
      } else if (quotedMsg.documentMessage) {
        const fname = media.fileName || `saved_document.${(await FileType.fromBuffer(media.buffer))?.ext || 'bin'}`;
        await socket.sendMessage(saveChat, { document: media.buffer, fileName: fname, mimetype: media.mime || 'application/octet-stream' });
      } else if (quotedMsg.stickerMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Sticker Saved' });
      }

      await socket.sendMessage(sender, { text: '🔥 *𝐒tatus 𝐒aved 𝐒uccessfully!*' }, { quoted: msg });

    } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
      const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
      await socket.sendMessage(saveChat, { text: `✅ *𝐒tatus 𝐒aved*\n\n${text}` });
      await socket.sendMessage(sender, { text: '🔥 *𝐓ext 𝐒tatus 𝐒aved 𝐒uccessfully!*' }, { quoted: msg });
    } else {
      if (typeof socket.copyNForward === 'function') {
        try {
          const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId || msg.key;
          await socket.copyNForward(saveChat, msg.key, true);
          await socket.sendMessage(sender, { text: '🔥 *𝐒aved (𝐅orwarded) 𝐒uccessfully!*' }, { quoted: msg });
        } catch (e) {
          await socket.sendMessage(sender, { text: '❌ Could not forward the quoted message.' }, { quoted: msg });
        }
      } else {
        await socket.sendMessage(sender, { text: '❌ Unsupported quoted message type.' }, { quoted: msg });
      }
    }

  } catch (error) {
    console.error('❌ Save error:', error);
    await socket.sendMessage(sender, { text: '*❌ Failed to save status*' }, { quoted: msg });
  }
  break;
} 
case 'xnxx':
case 'xnxxvideo': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_XNXX" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!Array.isArray(config.PREMIUM) || !config.PREMIUM.includes(senderNumber)) 
      return await socket.sendMessage(sender, { text: '❗ This command is for Premium users only.' }, { quoted: botMention });

    if (!text) return await socket.sendMessage(sender, { text: '❌ Provide a search name. Example: .xnxx <name>' }, { quoted: botMention });

    await socket.sendMessage(from, { react: { text: "🎥", key: msg.key } }, { quoted: botMention });

    const res = await axios.get(`https://api.genux.me/api/download/xnxx-download?query=${encodeURIComponent(text)}&apikey=GENUX-SANDARUX`);
    const d = res.data?.result;
    if (!d || !d.files) return await socket.sendMessage(sender, { text: '❌ No results.' }, { quoted: botMention });

    await socket.sendMessage(from, { image: { url: d.image }, caption: `💬 *Title*: ${d.title}\n👀 *Duration*: ${d.duration}\n🗯 *Desc*: ${d.description}\n💦 *Tags*: ${d.tags || ''}` }, { quoted: botMention });

    await socket.sendMessage(from, { video: { url: d.files.high, fileName: d.title + ".mp4", mimetype: "video/mp4", caption: "*Done ✅*" } }, { quoted: botMention });

    await socket.sendMessage(from, { text: "*Uploaded ✅*" }, { quoted: botMention });

  } catch (err) {
    console.error('xnxx error:', err);
    await socket.sendMessage(sender, { text: "❌ Error fetching video." }, { quoted: botMention });
  }
  break;
}
case 'system': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SYSTEM" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    const os = require('os');
    const text = `
*╭─────────────┈⊷*
*│⚙️𝚂𝙷𝙴𝚁𝙰-𝙼𝙳 𝚂𝙴𝚂𝚃𝙴𝙼 𝙸𝙽𝙵𝙾⚙️*
*╰─────────────┈⊷*
*╭─────────────┈⊷*
*│🚀 ᴏꜱ:* ${os.type()} ${os.release()}
*│🏅 ᴘʟᴀᴛꜰᴏʀᴍ:* ${os.platform()}
*│⛓️ ᴄᴘᴜ ᴄᴏʀᴇꜱ:* ${os.cpus().length}
*│💽 ᴍᴇᴍᴏʀʏ:* ${(os.totalmem()/1024/1024/1024).toFixed(2)} GB
*╰─────────────┈⊷*
> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
`;

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: `*${botName} 𝐒ʏꜱᴛᴇᴍ 𝐈ɴꜰᴏ* `,
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📒Mᴇɴᴜ" },type: 1 },
				{ buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👑Oᴡɴᴇʀ" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('system error', e);
    await socket.sendMessage(sender, { text: '❌ Failed to get system info.' }, { quoted: msg });
  }
  break;
}

case 'cvideo': {
  try {
    const axios = require('axios');

    // react
    try { await socket.sendMessage(sender, { react: { text: "🎬", key: msg.key } }); } catch(e){}

    // args: <targetJid> <search keywords>
    const targetArg = args[0];
    const query = args.slice(1).join(" ").trim();

    if (!targetArg || !query) {
      return await socket.sendMessage(sender, { 
        text: "*❌ Format Wrong!* Use: `.cvideo <jid|number|channelId> <TikTok keyword>`" 
      }, { quoted: msg });
    }

    // normalize target jid
    let targetJid = targetArg;
    if (!targetJid.includes('@')) {
      if (/^0029/.test(targetJid)) {
        targetJid = `${targetJid}@newsletter`;
      } else {
        targetJid = `${targetJid.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      }
    }

    // TikTok search
    await socket.sendMessage(sender, { text: `🔎 TikTok Search The One... (${query})` }, { quoted: msg });

    const params = new URLSearchParams({ keywords: query, count: '5', cursor: '0', HD: '1' });
    const response = await axios.post("https://tikwm.com/api/feed/search", params, {
      headers: {
        'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8",
        'Cookie': "current_language=en",
        'User-Agent': "Mozilla/5.0"
      }
    });

    const videos = response.data?.data?.videos;
    if (!videos || videos.length === 0) {
      return await socket.sendMessage(sender, { text: '⚠️ TikTok video Dont See.' }, { quoted: msg });
    }

    // get first video
    const v = videos[0];
    const videoUrl = v.play || v.download;
    if (!videoUrl) {
      return await socket.sendMessage(sender, { text: '❌ Video Is Not Downloaded.' }, { quoted: msg });
    }

    // resolve channel name
    let channelname = targetJid;
    try {
      if (typeof socket.newsletterMetadata === 'function') {
        const meta = await socket.newsletterMetadata("jid", targetJid);
        if (meta && meta.name) channelname = meta.name;
      }
    } catch(e){}

    // format date
    const dateStr = v.create_time ? new Date(v.create_time * 1000).toLocaleDateString() : 'Unknown';

    // ✨ caption style
    const caption = `☘️ ᴛɪᴛʟᴇ : ${v.title || 'Unknown'}

🎭 ${v.play_count || 'N/A'} Views, ${v.duration || 'N/A'} sec, ${dateStr}
*00:00 ───●────────── ${v.duration || '00:00'}*
Beautiful React Please ...💗😽🍃
> ${channelname}`;

    // send video (no ref / no meta / no bot name)
    await socket.sendMessage(targetJid, {
      video: { url: videoUrl },
      caption
    });

    // confirm to sender
    if (targetJid !== sender) {
      await socket.sendMessage(sender, { 
        text: `✅ TikTok video *${channelname}*Complete The Send ! 🎬😎` 
      }, { quoted: msg });
    }

  } catch (err) {
    console.error('cvideo TT error:', err);
    await socket.sendMessage(sender, { text: `❌Error: ${err.message}` }, { quoted: msg });
  }
  break;
}
            // Case: viewonce
case 'viewonce':
case 'rvo':
case 'vv': {
  await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });

  try {
    if (!msg.quoted) {
      return await socket.sendMessage(sender, {
        text: `🚩 *ᴘʟᴇᴀsᴇ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇssᴀɢᴇ*\n\n` +
              `📝 *ʜᴏᴡ ᴛᴏ ᴜsᴇ:*\n` +
              `• ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴠɪᴇᴡ-ᴏɴᴄᴇ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴏʀ ᴀᴜᴅɪᴏ\n` +
              `• ᴜsᴇ: ${config.PREFIX}vv\n` +
              `• ɪ'ʟʟ ʀᴇᴠᴇᴀʟ ᴛʜᴇ ʜɪᴅᴅᴇɴ ᴛʀᴇᴀsᴜʀᴇ ғᴏʀ ʏᴏᴜ`
      });
    }

    // Get the quoted message with multiple fallback approaches
    const contextInfo = msg.msg?.contextInfo;
    const quotedMessage = msg.quoted?.message || 
                         contextInfo?.quotedMessage || 
                         (contextInfo?.stanzaId ? await getQuotedMessage(contextInfo.stanzaId) : null);

    if (!quotedMessage) {
      return await socket.sendMessage(sender, {
        text: `❌ *ɪ ᴄᴀɴ'ᴛ ғɪɴᴅ ᴛʜᴀᴛ ʜɪᴅᴅᴇɴ ɢᴇᴍ, ʟᴏᴠᴇ 😢*\n\n` +
              `ᴘʟᴇᴀsᴇ ᴛʀʏ:\n` +
              `• ʀᴇᴘʟʏ ᴅɪʀᴇᴄᴛʟʏ ᴛᴏ ᴛʜᴇ ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇssᴀɢᴇ\n` +
              `• ᴍᴀᴋᴇ sᴜʀᴇ ɪᴛ ʜᴀsɴ'ᴛ ᴠᴀɴɪsʜᴇᴅ!`
      });
    }

    // Check for view once message
    let fileType = null;
    let mediaMessage = null;
    
    if (quotedMessage.viewOnceMessageV2) {
      // Handle viewOnceMessageV2 (newer format)
      const messageContent = quotedMessage.viewOnceMessageV2.message;
      if (messageContent.imageMessage) {
        fileType = 'image';
        mediaMessage = messageContent.imageMessage;
      } else if (messageContent.videoMessage) {
        fileType = 'video';
        mediaMessage = messageContent.videoMessage;
      } else if (messageContent.audioMessage) {
        fileType = 'audio';
        mediaMessage = messageContent.audioMessage;
      }
    } else if (quotedMessage.viewOnceMessage) {
      // Handle viewOnceMessage (older format)
      const messageContent = quotedMessage.viewOnceMessage.message;
      if (messageContent.imageMessage) {
        fileType = 'image';
        mediaMessage = messageContent.imageMessage;
      } else if (messageContent.videoMessage) {
        fileType = 'video';
        mediaMessage = messageContent.videoMessage;
      }
    } else if (quotedMessage.imageMessage?.viewOnce || 
               quotedMessage.videoMessage?.viewOnce || 
               quotedMessage.audioMessage?.viewOnce) {
      // Handle direct viewOnce properties
          if (quotedMessage.imageMessage?.viewOnce) {
        fileType = 'image';
        mediaMessage = quotedMessage.imageMessage;
      } else if (quotedMessage.videoMessage?.viewOnce) {
        fileType = 'video';
        mediaMessage = quotedMessage.videoMessage;
      } else if (quotedMessage.audioMessage?.viewOnce) {
        fileType = 'audio';
        mediaMessage = quotedMessage.audioMessage;
      }
    }

    if (!fileType || !mediaMessage) {
      return await socket.sendMessage(sender, {
        text: `⚠️ *ᴛʜɪs ɪsɴ'ᴛ ᴀ ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇssᴀɢᴇ*\n\n` +
              `ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴡɪᴛʜ ʜɪᴅᴅᴇɴ ᴍᴇᴅɪᴀ (ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴏʀ ᴀᴜᴅɪᴏ)`
      });
    }

    await socket.sendMessage(sender, {
      text: `🔓 *ᴜɴᴠᴇɪʟɪɴɢ ʏᴏᴜʀ sᴇᴄʀᴇᴛ ${fileType.toUpperCase()}...*`
    });

    // Download and send the media
  const mediaBuffer = await downloadMediaMessage(
      { 
        key: msg.quoted.key, 
        message: { 
          [fileType + 'Message']: mediaMessage 
        } 
      },
      'buffer',
      {}
    );

    if (!mediaBuffer) {
      throw new Error('Failed to download media');
    }

    // Determine the mimetype and filename
    const mimetype = mediaMessage.mimetype || 
                    (fileType === 'image' ? 'image/jpeg' : 
                     fileType === 'video' ? 'video/mp4' : 'audio/mpeg');
    
    const extension = mimetype.split('/')[1];
    const filename = `revealed-${fileType}-${Date.now()}.${extension}`;

    // Prepare message options based on media type
    let messageOptions = {
      caption: `✨ *ʀᴇᴠᴇᴀʟᴇᴅ ${fileType.toUpperCase()}* - ʏᴏᴜ'ʀᴇ ᴡᴇʟᴄᴏᴍᴇ`
    };

    // Send the media based on its type
    if (fileType === 'image') {
      await socket.sendMessage(sender, {
        image: mediaBuffer,
        ...messageOptions
      });
    } else if (fileType === 'video') {
      await socket.sendMessage(sender, {
        video: mediaBuffer,
        ...messageOptions
      });
    } else if (fileType === 'audio') {
      await socket.sendMessage(sender, {
        audio: mediaBuffer,
        ...messageOptions,
        mimetype: mimetype
      });
    }

    await socket.sendMessage(sender, {
      react: { text: '✅', key: msg.key }
    });
  } catch (error) {
    console.error('ViewOnce command error:', error);
    let errorMessage = `❌ *ᴏʜ ɴᴏ, ɪ ᴄᴏᴜʟᴅɴ'ᴛ ᴜɴᴠᴇɪʟ ɪᴛ*\n\n`;

    if (error.message?.includes('decrypt') || error.message?.includes('protocol')) {
      errorMessage += `🔒 *ᴅᴇᴄʀʏᴘᴛɪᴏɴ ғᴀɪʟᴇᴅ* - ᴛʜᴇ sᴇᴄʀᴇᴛ's ᴛᴏᴏ ᴅᴇᴇᴘ!`;
    } else if (error.message?.includes('download') || error.message?.includes('buffer')) {
      errorMessage += `📥 *ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ* - ᴄʜᴇᴄᴋ ʏᴏᴜʀ ᴄᴏɴɴᴇᴄᴛɪᴏɴ.`;
    } else if (error.message?.includes('expired') || error.message?.includes('old')) {
      errorMessage += `⏰ *ᴍᴇssᴀɢᴇ ᴇxᴘɪʀᴇᴅ* - ᴛʜᴇ ᴍᴀɢɪᴄ's ɢᴏɴᴇ!`;
    } else {
      errorMessage += `🐛 *ᴇʀʀᴏʀ:* ${error.message || 'sᴏᴍᴇᴛʜɪɴɢ ᴡᴇɴᴛ ᴡʀᴏɴɢ'}`;
    }

    errorMessage += `\n\n💡 *ᴛʀʏ:*\n• ᴜsɪɴɢ ᴀ ғʀᴇsʜ ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇssᴀɢᴇ\n• ᴄʜᴇᴄᴋɪɴɢ ʏᴏᴜʀ ɪɴᴛᴇʀɴᴇᴛ ᴄᴏɴɴᴇᴄᴛɪᴏɴ`;

    await socket.sendMessage(sender, { text: errorMessage });
    await socket.sendMessage(sender, {
      react: { text: '❌', key: msg.key }
    });
  }
  break;
}
// Case: song
case 'song': {
  const yts = require('yt-search');
  const axios = require('axios');
  const apikey = "dew_BjunzZG9n2yaqkPuaYgVYefwu2GDQLapPfkcZWlG";
  const apibase = "https://api.srihub.store"

  const q = msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";

  if (!q.trim()) {
    return await socket.sendMessage(sender, { 
      text: '*Need YouTube URL or Title.*' 
    }, { quoted: msg });
  }

  const extractYouTubeId = (url) => {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const normalizeYouTubeLink = (str) => {
    const id = extractYouTubeId(str);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  };

  try {
    await socket.sendMessage(sender, { 
      react: { text: "🔍", key: msg.key } 
    });

    let videoUrl = normalizeYouTubeLink(q.trim());
    let videoData = null;

    if (!videoUrl) {
      const search = await yts(q.trim());
      const found = search?.videos?.[0];

      if (!found) {
        return await socket.sendMessage(sender, {
          text: "*No results found.*"
        }, { quoted: msg });
      }

      videoUrl = found.url;
      videoData = found;
    }

    const api = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodeURIComponent(videoUrl)}`;
    const get = await axios.get(api).then(r => r.data).catch(() => null);

    if (!get?.result) {
      return await socket.sendMessage(sender, {
        text: "*API Error. Try again later.*"
      }, { quoted: msg });
    }

    const { download_url, title, thumbnail, duration, quality, views } = get.result;
    
    const videoId = extractYouTubeId(videoUrl);
    const shortUrl = `https://youtu.be/${videoId}`;
    
    const caption = `*ꜱʜᴇʀᴀ-ᴍᴅ ᴠ4 ꜱᴏɴɢ🎧*
    
◈ 𝐒𝐎𝐍𝐆 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃🎧 ◈

╭❏🎵 *ᴛɪᴛʟᴇ:* ${title}
├❏⏱️ *ᴅᴜʀᴀᴛɪᴏɴ:* ${duration || 'N/A'}
├❏🔊 *Qᴜᴀʟɪᴛʏ:* ${quality || '128kbps'}
╰❏🔗 *ᴜʀʟ:* ${shortUrl}

❮ꜱᴏɴɢ ᴅᴏᴡɴʟᴏᴀᴅ ɪꜱ ꜱʜᴇʀᴀ-ᴍᴅ ᴠ4ɪɴꜰᴏ❯

> *⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍*`;

    // Create simple buttons instead of complex native flow
    const buttons = [
      {
        buttonId: 'song_doc',
        buttonText: { displayText: '📁 ᴅᴜᴄᴜᴍᴇɴᴛ' },
        type: 1
      },
      {
        buttonId: 'song_audio',
        buttonText: { displayText: '🎵 ᴀᴜᴅɪᴏ' },
        type: 1
      },
      {
        buttonId: 'song_ptt',
        buttonText: { displayText: '🎤 ᴠᴏɪꜱᴇ ɴᴏᴛᴇ' },
        type: 1
      }
    ];

    // Send message with image and buttons
    const resMsg = await socket.sendMessage(sender, {
      image: { url: thumbnail },
      caption: caption,
      buttons: buttons,
      headerType: 4,
      viewOnce: false
    }, { quoted: msg });

    // Handler for button responses
    const handler = async (msgUpdate) => {
      try {
        const received = msgUpdate.messages && msgUpdate.messages[0];
        if (!received) return;

        const fromId = received.key.remoteJid || received.key.participant || (received.key.fromMe && sender);
        if (fromId !== sender) return;

        // Check for button response
        const buttonResponse = received.message?.buttonsResponseMessage;
        if (buttonResponse) {
          const contextId = buttonResponse.contextInfo?.stanzaId;
          if (!contextId || contextId !== resMsg.key.id) return;

          const selectedId = buttonResponse.selectedButtonId;

          await socket.sendMessage(sender, { 
            react: { text: "📥", key: received.key } 
          });

          switch (selectedId) {
            case 'song_doc':
              await socket.sendMessage(sender, {
                document: { url: download_url },
                mimetype: "audio/mpeg",
                fileName: `${title.replace(/[^\w\s]/gi, '')}.mp3`
              }, { quoted: received });
              break;
            case 'song_audio':
              await socket.sendMessage(sender, {
                audio: { url: download_url },
                mimetype: "audio/mpeg",
                fileName: `${title.replace(/[^\w\s]/gi, '')}.mp3`
              }, { quoted: received });
              break;
            case 'song_ptt':
              await socket.sendMessage(sender, {
                audio: { url: download_url },
                mimetype: "audio/mpeg",
                ptt: true
              }, { quoted: received });
              break;
            default:
              return;
          }

          // Cleanup
          socket.ev.off('messages.upsert', handler);
          return;
        }

        // Check for text response (fallback)
        const text = received.message?.conversation || received.message?.extendedTextMessage?.text;
        if (!text) return;

        const quotedId = received.message?.extendedTextMessage?.contextInfo?.stanzaId ||
          received.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id;
        if (!quotedId || quotedId !== resMsg.key.id) return;

        const choice = text.toString().trim().split(/\s+/)[0];

        await socket.sendMessage(sender, { 
          react: { text: "📥", key: received.key } 
        });

        switch (choice) {
          case "1":
          case "doc":
          case "document":
            await socket.sendMessage(sender, {
              document: { url: download_url },
              mimetype: "audio/mpeg",
              fileName: `${title.replace(/[^\w\s]/gi, '')}.mp3`
            }, { quoted: received });
            break;
          case "2":
          case "audio":
          case "song":
            await socket.sendMessage(sender, {
              audio: { url: download_url },
              mimetype: "audio/mpeg",
              fileName: `${title.replace(/[^\w\s]/gi, '')}.mp3`
            }, { quoted: received });
            break;
          case "3":
          case "ptt":
          case "voice":
            await socket.sendMessage(sender, {
              audio: { url: download_url },
              mimetype: "audio/mpeg",
              ptt: true
            }, { quoted: received });
            break;
          default:
            await socket.sendMessage(sender, {
              text: "*Invalid option. Use 1, 2 or 3 or click buttons.*"
            }, { quoted: received });
            return;
        }

        socket.ev.off('messages.upsert', handler);
      } catch (err) {
        console.error("Song handler error:", err);
        try { socket.ev.off('messages.upsert', handler); } catch (e) {}
      }
    };

    // Add handler
    socket.ev.on('messages.upsert', handler);

    // Auto-remove handler after 60s
    setTimeout(() => {
      try { socket.ev.off('messages.upsert', handler); } catch (e) {}
    }, 60 * 1000);

    // React with success
    await socket.sendMessage(sender, { 
      react: { text: '✅', key: msg.key } 
    });

  } catch (err) {
    console.error('Song case error:', err);
    await socket.sendMessage(sender, { 
      text: "*Error occurred while processing song request*" 
    }, { quoted: msg });
  }
  break;
} 
case 'video': {
  const yts = require('yt-search');
  const axios = require('axios'); // axios භාවිතා කරන්න
  const apibase = "https://api.srihub.store";
  const apikey = "dew_BjunzZG9n2yaqkPuaYgVYefwu2GDQLapPfkcZWlG";
  
  await socket.sendMessage(from, { react: { text: '🎥', key: msg.key } });

  // Extract YouTube ID
  function extractYouTubeId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  // Normalize YouTube URL
  function normalizeLink(input) {
    const id = extractYouTubeId(input);
    return id ? `https://www.youtube.com/watch?v=${id}` : input;
  }

  const q =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  if (!q.trim()) {
    return socket.sendMessage(from, { text: '*Enter YouTube URL or Title.*' });
  }

  const query = normalizeLink(q.trim());

  try {
    // YouTube search
    const searchResults = await yts(query);
    const v = searchResults.videos[0];
    if (!v) return socket.sendMessage(from, { text: '*No results found.*' });

    const youtubeUrl = v.url;
    const encodedUrl = encodeURIComponent(youtubeUrl);

    const caption = `*ꜱʜᴇʀᴀ-ᴍᴅ ᴠ4 ᴠɪᴅᴇᴏ*

◈ 𝐕𝐈𝐃𝐄𝐎 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐅🎥 ◈

*╭❏🎵 Title* : ${v.title}
*├❏⏱️ Length* : ${v.timestamp}
*├❏👀 Views* : ${v.views}
*├❏🗓️ Date* : ${v.ago}
*╰❏🔗 Link* : https://youtu.be/${extractYouTubeId(youtubeUrl) || 'N/A'}

❮ᴠɪᴅᴇᴏ ᴅᴏᴡɴʟᴏᴀᴅ ɪꜱ ꜱʜᴇʀᴀ-ᴍᴅ ᴠ4 ɪɴꜰᴏ❯

> *⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍*`;

    // Create buttons for format selection
    const buttons = [
      {
        buttonId: 'video_video',
        buttonText: { displayText: '🎬 ᴠɪᴅᴇᴏ ◎' },
        type: 1
      },
      {
        buttonId: 'video_doc',
        buttonText: { displayText: '📁 ᴅᴏᴄᴜᴍᴇɴᴛ ◎' },
        type: 1
      },
      {
        buttonId: 'video_audio',
        buttonText: { displayText: '🎵 ᴀᴜᴅɪᴏ ◎' },
        type: 1
      }
    ];

    const sentMsg = await socket.sendMessage(
      from,
      {
        image: { url: v.thumbnail },
        caption: caption,
        buttons: buttons,
        headerType: 4
      },
      { quoted: msg }
    );

    // Handler for button responses
    const handler = async (update) => {
      try {
        const m = update.messages && update.messages[0];
        if (!m) return;

        const fromId = m.key.remoteJid || m.key.participant;
        if (fromId !== from) return;

        // Check for button response
        const buttonResponse = m.message?.buttonsResponseMessage;
        if (buttonResponse) {
          const contextId = buttonResponse.contextInfo?.stanzaId;
          if (!contextId || contextId !== sentMsg.key.id) return;

          const selectedId = buttonResponse.selectedButtonId;

          await socket.sendMessage(from, { 
            react: { text: "📥", key: m.key } 
          });

          let downloadUrl, fileName, mimeType;

          try {
            if (selectedId === 'video_video' || selectedId === 'video_doc') {
              // Video download
              const videoApiUrl = `${apibase}/download/ytmp4?apikey=${apikey}&url=${encodedUrl}&format=1080`;
              console.log('Fetching video from:', videoApiUrl);
              
              const videoResponse = await axios.get(videoApiUrl, { timeout: 30000 });
              const videoData = videoResponse.data;

              console.log('Video API response:', JSON.stringify(videoData, null, 2));

              if (!videoData.success || !videoData.result?.download_url) {
                console.error('Video download API error:', videoData);
                return socket.sendMessage(from, { 
                  text: "❌ Video download failed. API returned an error." 
                }, { quoted: m });
              }

              downloadUrl = videoData.result.download_url;
              fileName = `${v.title.replace(/[^\w\s]/gi, '')}.mp4`;
              mimeType = "video/mp4";

              console.log('Download URL:', downloadUrl);

              if (selectedId === 'video_video') {
                // Send as video
                await socket.sendMessage(from, {
                  video: { url: downloadUrl },
                  mimetype: mimeType,
                  caption: `*${v.title}*`
                }, { quoted: m });
              } else if (selectedId === 'video_doc') {
                // Send as document
                await socket.sendMessage(from, {
                  document: { url: downloadUrl },
                  mimetype: mimeType,
                  fileName: fileName,
                  caption: `*${v.title}*`
                }, { quoted: m });
              }

            } else if (selectedId === 'video_audio') {
              // Audio download (MP3)
              const audioApiUrl = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodedUrl}`;
              console.log('Fetching audio from:', audioApiUrl);
              
              const audioResponse = await axios.get(audioApiUrl, { timeout: 30000 });
              const audioData = audioResponse.data;

              console.log('Audio API response:', JSON.stringify(audioData, null, 2));

              if (!audioData.success || !audioData.result?.download_url) {
                console.error('Audio download API error:', audioData);
                return socket.sendMessage(from, { 
                  text: "❌ Audio download failed. API returned an error." 
                }, { quoted: m });
              }

              downloadUrl = audioData.result.download_url;
              fileName = `${v.title.replace(/[^\w\s]/gi, '')}.mp3`;

              console.log('Audio Download URL:', downloadUrl);

              // Send as audio
              await socket.sendMessage(from, {
                audio: { url: downloadUrl },
                mimetype: "audio/mpeg",
                ptt: false, // Voice message ලෙස නොව සාමාන්ය audio ලෙස
                fileName: fileName,
                caption: `*${v.title}*`
              }, { quoted: m });
            }

          } catch (apiError) {
            console.error('API Error:', apiError);
            await socket.sendMessage(from, { 
              text: `❌ Download failed: ${apiError.message || 'Unknown error'}` 
            }, { quoted: m });
          }

          // Clean up
          socket.ev.off("messages.upsert", handler);
          return;
        }

        // Check for text response (fallback)
        const text = m.message?.conversation || m.message?.extendedTextMessage?.text;
        if (!text) return;

        // Check if this is a reply to our message
        if (m.message.extendedTextMessage?.contextInfo?.stanzaId !== sentMsg.key.id) return;

        const selected = text.trim();

        await socket.sendMessage(from, { 
          react: { text: "📥", key: m.key } 
        });

        try {
          if (selected === "1") {
            // Video download
            const videoApiUrl = `${apibase}/download/ytmp4?apikey=${apikey}&url=${encodedUrl}&format=1080`;
            const videoResponse = await axios.get(videoApiUrl);
            const videoData = videoResponse.data;

            if (!videoData.success || !videoData.result?.download_url) {
              return socket.sendMessage(from, { 
                text: "❌ Video download failed." 
              }, { quoted: m });
            }

            const downloadUrl = videoData.result.download_url;
            await socket.sendMessage(from, {
              video: { url: downloadUrl },
              mimetype: "video/mp4",
              caption: `*${v.title}*`
            }, { quoted: m });

          } else if (selected === "2") {
            // Video as document
            const videoApiUrl = `${apibase}/download/ytmp4?apikey=${apikey}&url=${encodedUrl}&format=1080`;
            const videoResponse = await axios.get(videoApiUrl);
            const videoData = videoResponse.data;

            if (!videoData.success || !videoData.result?.download_url) {
              return socket.sendMessage(from, { 
                text: "❌ Video download failed." 
              }, { quoted: m });
            }

            const downloadUrl = videoData.result.download_url;
            await socket.sendMessage(from, {
              document: { url: downloadUrl },
              mimetype: "video/mp4",
              fileName: `${v.title.replace(/[^\w\s]/gi, '')}.mp4`,
              caption: `*${v.title}*`
            }, { quoted: m });

          } else if (selected === "3") {
            // Audio download (MP3)
            const audioApiUrl = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodedUrl}`;
            const audioResponse = await axios.get(audioApiUrl);
            const audioData = audioResponse.data;

            if (!audioData.success || !audioData.result?.download_url) {
              return socket.sendMessage(from, { 
                text: "❌ Audio download failed." 
              }, { quoted: m });
            }

            const downloadUrl = audioData.result.download_url;
            await socket.sendMessage(from, {
              audio: { url: downloadUrl },
              mimetype: "audio/mpeg",
              ptt: false,
              caption: `*${v.title}*`
            }, { quoted: m });

          } else {
            await socket.sendMessage(from, { 
              text: "❌ Invalid option. Please click the buttons." 
            }, { quoted: m });
            return;
          }

        } catch (apiError) {
          console.error('API Error in text response:', apiError);
          await socket.sendMessage(from, { 
            text: "❌ Download failed. Please try again." 
          }, { quoted: m });
        }

        // Clean up
        socket.ev.off("messages.upsert", handler);

      } catch (error) {
        console.error("Handler error:", error);
        await socket.sendMessage(from, { 
          text: "❌ An error occurred. Please try again." 
        }, { quoted: msg });
        socket.ev.off("messages.upsert", handler);
      }
    };

    // Add event listener
    socket.ev.on("messages.upsert", handler);

    // Auto remove listener after 5 minutes
    setTimeout(() => {
      try {
        socket.ev.off("messages.upsert", handler);
      } catch (e) {
        console.error('Error removing listener:', e);
      }
    }, 5 * 60 * 1000);

  } catch (e) {
    console.error('Main error:', e);
    socket.sendMessage(from, { 
      text: "*❌ Error fetching video. Please check the URL or try again later.*" 
    });
  }
  break;
}
//===============================   
          case 'logo': { 
                    const q = args.join(" ");
                    
                    
                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, { text: '*`ɴᴇᴇᴅ ᴀ ɴᴀᴍᴇ ғᴏʀ ʟᴏɢᴏ`*' });
                    }

                    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
                    const list = await axios.get('https://raw.githubusercontent.com/md2839pv404/anony0808/refs/heads/main/ep.json');

                    const rows = list.data.map((v) => ({
                        title: v.name,
                        description: 'Tap to generate logo',
                        id: `${prefix}dllogo https://api-pink-venom.vercel.app/api/logo?url=${v.url}&name=${q}`
                    }));
                    
                    const buttonMessage = {
                        buttons: [
                            {
                                buttonId: 'action',
                                buttonText: { displayText: '🎨 sᴇʟᴇᴄᴛ ᴛᴇxᴛ ᴇғғᴇᴄᴛ' },
                                type: 4,
                                nativeFlowInfo: {
                                    name: 'single_select',
                                    paramsJson: JSON.stringify({
                                        title: 'Available Text Effects',
                                        sections: [
                                            {
                                                title: 'Choose your logo style',
                                                rows
                                            }
                                        ]
                                    })
                                }
                            }
                        ],
                        headerType: 1,
                        viewOnce: true,
                        caption: '❏ *ʟᴏɢᴏ ᴍᴀᴋᴇʀ*',
                        image: { url: 'https://files.catbox.moe/bhga2o.jpg' },
                    };

                    await socket.sendMessage(from, buttonMessage, { quoted: fakevCard });
                    break;
                }
//===============================                
// 9
          case 'dllogo': { 
                await socket.sendMessage(sender, { react: { text: '🔋', key: msg.key } });
                    const q = args.join(" "); 
                    
                    if (!q) return await socket.sendMessage(from, { text: "ᴘʟᴇᴀsᴇ ɢɪᴠᴇ ᴍᴇ ᴀ ᴜʀʟ ᴛᴏ ᴄᴀᴘᴛᴜʀᴇ ᴛʜᴇ sᴄʀᴇᴇɴsʜᴏᴛ" }, { quoted: fakevCard });
                    
                    try {
                        const res = await axios.get(q);
                        const images = res.data.result.download_url;

                        await socket.sendMessage(m.chat, {
                            image: { url: images },
                            caption: config.CAPTION
                        }, { quoted: msg });
                    } catch (e) {
                        console.log('Logo Download Error:', e);
                        await socket.sendMessage(from, {
                            text: `❌ Oh, sweetie, something went wrong with the logo... 💔 Try again?`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
                               
//===============================
                case 'fancy': {
                await socket.sendMessage(sender, { react: { text: '🖋', key: msg.key } });
                    const axios = require("axios");
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const text = q.trim().replace(/^.fancy\s+/i, "");

                    if (!text) {
                        return await socket.sendMessage(sender, {
                            text: "❎ *ɢɪᴠᴇ ᴍᴇ some ᴛᴇxᴛ ᴛᴏ ᴍᴀᴋᴇ ɪᴛ ғᴀɴᴄʏ*\n\n📌 *ᴇxᴀᴍᴘʟᴇ:* `.ꜱʜᴇʀᴀ-ʙᴏʏ`"
                        });
                    }

                    try {
                        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data.status || !response.data.result) {
                            return await socket.sendMessage(sender, {
                                text: "❌ ᴛʜᴇ ғᴏɴᴛs ɢᴏᴛ sʜʏ! ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ*"
                            });
                        }

                        const fontList = response.data.result
                            .map(font => `*${font.name}:*\n${font.result}`)
                            .join("\n\n");

                        const finalMessage = `🎨 *ғᴀɴᴄʏ ғᴏɴᴛs ᴄᴏɴᴠᴇʀᴛᴇʀ*\n\n${fontList}\n\n> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`;

                        await socket.sendMessage(sender, {
                            text: finalMessage
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error("Fancy Font Error:", err);
                        await socket.sendMessage(sender, {
                            text: "⚠️ *Something went wrong with the fonts, love 😢 Try again?*"
                        });
                    }
                    break;
                    }
                
// ==================== TIKTOK SEARCH ====================
case 'ts':
case 'tiktoksearch': {
  // 1. Reaction
  try { await socket.sendMessage(sender, { react: { text: "🔍", key: msg.key } }); } catch(e){}

  // 2. pushname
  const pushname = msg?.pushname || msg?.notifyName || 'User';

  // 3. Load user config (botName, logo)
  let userCfg = {};
  try { 
    if (number && typeof loadUserConfigFromMongo === 'function') 
      userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; 
  } catch(e){ userCfg = {}; }

  const botName = userCfg.botName || 'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍';
  const prefix = config?.PREFIX || '.';
  const thumbnailUrl = userCfg.logo || config?.RCD_IMAGE_PATH || 'https://files.catbox.moe/bhga2o.jpg';

  // 4. Fake quoted vCard (menu style)
  const fakeQuote = {
    key: {
      remoteJid: "status@broadcast",
      participant: "0@s.whatsapp.net",
      fromMe: false,
      id: "META_AI_FAKE_ID_TS"
    },
    message: {
      contactMessage: {
        displayName: botName,
        vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
      }
    }
  };

  // 5. Get search query
  const q = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || '';

  let query = q.replace(/^[.\/!](ts|tiktoksearch)\s*/i, '').trim();

  if (!query) {
    const usageMsg = `
👋 HI ${pushname}

*╭── 「 ᴛɪᴋᴛᴏᴋ ꜱᴇᴀʀᴄʜ 」*
*┃❓ ᴘʟᴇᴀꜱᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ꜱᴇᴀʀᴄʜ ᴛᴇʀᴍ.*
*┃📌 ᴇxᴀᴍᴘʟᴇ :* ${prefix}ts cats
*┃📌 ᴇxᴀᴍᴘʟᴇ :* ${prefix}tiktoksearch dance
*╰─────────────────⦁*

> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
    `.trim();
    return await socket.sendMessage(sender, { text: usageMsg }, { quoted: fakeQuote });
  }

  // 6. Processing message
  const processingMsg = await socket.sendMessage(sender, {
    text: `⏳ *Searching TikTok for "${query}"...*`
  }, { quoted: fakeQuote });

  try {
    const axios = require('axios');
    const searchParams = new URLSearchParams({ keywords: query, count: '10', cursor: '0', HD: '1' });
    const response = await axios.post("https://tikwm.com/api/feed/search", searchParams, {
      headers: { 'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8", 'Cookie': "current_language=en", 'User-Agent': "Mozilla/5.0" }
    });

    // Delete processing message
    if (processingMsg) {
      await socket.sendMessage(sender, { delete: processingMsg.key });
    }

    const videos = response.data?.data?.videos;
    if (!videos || videos.length === 0) {
      const noResultsMsg = `
👋 HI ${pushname}

*╭── 「 ɴᴏ ʀᴇꜱᴜʟᴛꜱ 」*
*┃❌ ɴᴏ ᴛɪᴋᴛᴏᴋ ᴠɪᴅᴇᴏꜱ ꜰᴏᴜɴᴅ ꜰᴏʀ "${query}".*
*╰─────────────────⦁*

> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
      `.trim();
      return await socket.sendMessage(sender, { text: noResultsMsg }, { quoted: fakeQuote });
    }

    // Limit number of videos to send (max 3)
    const limit = 3;
    const results = videos.slice(0, limit);

    // Send search summary as a styled message with buttons
    const summaryCaption = `
👋 HI ${pushname}

*╭── 「 ᴛɪᴋᴛᴏᴋ ꜱᴇᴀʀᴄʜ ʀᴇꜱᴜʟᴛꜱ 」*
*┃🔍 ǫᴜᴇʀʏ :* ${query}
*┃📊 ᴛᴏᴛᴀʟ :* ${videos.length} found
*┃🎬 ꜱʜᴏᴡɪɴɢ :* ${limit} videos
*╰─────────────────⦁*

> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
`.trim();

    const summaryButtons = [
      { buttonId: `${prefix}menu`, buttonText: { displayText: "🔙 ᴍᴇɴᴜ" }, type: 1 },
      { buttonId: `${prefix}ts ${query}`, buttonText: { displayText: "🔄 ꜱᴇᴀʀᴄʜ ᴀɢᴀɪɴ" }, type: 1 },
      { buttonId: `${prefix}owner`, buttonText: { displayText: "👑 ᴏᴡɴᴇʀ" }, type: 1 }
    ];

    const tiktokIcon = 'https://cdn-icons-png.flaticon.com/512/3046/3046121.png'; // TikTok icon

    await socket.sendMessage(sender, {
      image: { url: tiktokIcon },
      caption: summaryCaption,
      buttons: summaryButtons,
      headerType: 1,
      contextInfo: {
        mentionedJid: [sender],
        forwardingScore: 999,
        isForwarded: true,
        externalAdReply: {
          title: botName,
          body: "ᴛɪᴋᴛᴏᴋ ꜱᴇᴀʀᴄʜ",
          thumbnailUrl: thumbnailUrl,
          sourceUrl: "https://www.tiktok.com",
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: fakeQuote });

    // Send each video with its own caption
    for (let i = 0; i < results.length; i++) {
      const v = results[i];
      const videoUrl = v.play || v.download || null;
      if (!videoUrl) continue;

      const videoCaption = `
*🎵 ᴛɪᴋᴛᴏᴋ ᴠɪᴅᴇᴏ #${i+1}*
*📹 ᴛɪᴛʟᴇ :* ${v.title || 'No Title'}
*👤 ᴀᴜᴛʜᴏʀ :* ${v.author?.nickname || 'Unknown'}
*❤️ ʟɪᴋᴇꜱ :* ${v.digg_count || 0}
*💬 ᴄᴏᴍᴍᴇɴᴛꜱ :* ${v.comment_count || 0}

> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
`.trim();

      await socket.sendMessage(sender, {
        video: { url: videoUrl },
        caption: videoCaption,
        contextInfo: {
          mentionedJid: [sender],
          forwardingScore: 999,
          isForwarded: true,
          externalAdReply: {
            title: botName,
            body: "ᴛɪᴋᴛᴏᴋ ᴠɪᴅᴇᴏ",
            thumbnailUrl: thumbnailUrl,
            sourceUrl: "https://www.tiktok.com",
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: fakeQuote });
    }

    console.log('✅ TikTok search completed');
  } catch (err) {
    console.error('TikTok search error:', err);
    if (processingMsg) {
      await socket.sendMessage(sender, { delete: processingMsg.key });
    }
    await socket.sendMessage(sender, {
      text: `❌ Failed to search TikTok: ${err.message}`
    }, { quoted: fakeQuote });
  }
  break;
}
//===============================

                    
                          case 'bomb': {
                    await socket.sendMessage(sender, { react: { text: '🔥', key: msg.key } });
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text || '';
                    const [target, text, countRaw] = q.split(',').map(x => x?.trim());

                    const count = parseInt(countRaw) || 5;

                    if (!target || !text || !count) {
                        return await socket.sendMessage(sender, {
                            text: '📌 *ᴜsᴀɢᴇ:* .bomb <number>,<message>,<count>\n\nExample:\n.bomb 554XXXXXXX,Hello 👋,5'
                        }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Easy, tiger! Max 20 messages per bomb, okay? 😘*'
                        }, { quoted: msg });
                    }

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `✅ Bomb sent to ${target} — ${count}! 💣😉`
                    }, { quoted: fakevCard });
                    break;
                }
//===============================
// 13

                                
// ┏━━━━━━━━━━━━━━━❖
// ┃ FUN & ENTERTAINMENT COMMANDS
// ┗━━━━━━━━━━━━━━━❖

case "joke": {
    try {
        await socket.sendMessage(sender, { react: { text: '🤣', key: msg.key } });
        const res = await fetch('https://v2.jokeapi.dev/joke/Any?type=single');
        const data = await res.json();
        if (!data || !data.joke) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a joke right now. Try again later.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🃏 *Random Joke:*\n\n${data.joke}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch joke.' }, { quoted: fakevCard });
    }
    break;
}


case "waifu": {
    try {
        await socket.sendMessage(sender, { react: { text: '🥲', key: msg.key } });
        const res = await fetch('https://api.waifu.pics/sfw/waifu');
        const data = await res.json();
        if (!data || !data.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch waifu image.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.url },
            caption: '✨ Here\'s your random waifu!'
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to get waifu.' }, { quoted: fakevCard });
    }
    break;
}

case "meme": {
    try {
        await socket.sendMessage(sender, { react: { text: '😂', key: msg.key } });
        const res = await fetch('https://meme-api.com/gimme');
        const data = await res.json();
        if (!data || !data.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch meme.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.url },
            caption: `🤣 *${data.title}*`
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch meme.' }, { quoted: fakevCard });
    }
    break;
}

case "cat": {
    try {
        await socket.sendMessage(sender, { react: { text: '🐱', key: msg.key } });
        const res = await fetch('https://api.thecatapi.com/v1/images/search');
        const data = await res.json();
        if (!data || !data[0]?.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch cat image.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data[0].url },
            caption: '🐱 ᴍᴇᴏᴡ~ ʜᴇʀᴇ\'s a ᴄᴜᴛᴇ ᴄᴀᴛ ғᴏʀ ʏᴏᴜ!'
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch cat image.' }, { quoted: fakevCard });
    }
    break;
}

case "dog": {
    try {
        await socket.sendMessage(sender, { react: { text: '🦮', key: msg.key } });
        const res = await fetch('https://dog.ceo/api/breeds/image/random');
        const data = await res.json();
        if (!data || !data.message) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch dog image.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.message },
            caption: '🐶 Woof! Here\'s a cute dog!'
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch dog image.' }, { quoted: fakevCard });
    }
    break;
}

case "fact": {
    try {
        await socket.sendMessage(sender, { react: { text: '😑', key: msg.key } });
        const res = await fetch('https://uselessfacts.jsph.pl/random.json?language=en');
        const data = await res.json();
        if (!data || !data.text) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a fact.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `💡 *Random Fact:*\n\n${data.text}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a fact.' }, { quoted: fakevCard });
    }
    break;
}

case "darkjoke": case "darkhumor": {
    try {
        await socket.sendMessage(sender, { react: { text: '😬', key: msg.key } });
        const res = await fetch('https://v2.jokeapi.dev/joke/Dark?type=single');
        const data = await res.json();
        if (!data || !data.joke) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a dark joke.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🌚 *Dark Humor:*\n\n${data.joke}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch dark joke.' }, { quoted: fakevCard });
    }
    break;
}

// ┏━━━━━━━━━━━━━━━❖
// ┃ ROMANTIC, SAVAGE & THINKY COMMANDS
// ┗━━━━━━━━━━━━━━━❖

case "pickup": case "pickupline": {
    try {
        await socket.sendMessage(sender, { react: { text: '🥰', key: msg.key } });
        const res = await fetch('https://vinuxd.vercel.app/api/pickup');
        const data = await res.json();
        if (!data || !data.data) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t find a pickup line.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `💘 *Pickup Line:*\n\n_${data.data}_` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch pickup line.' }, { quoted: fakevCard });
    }
    break;
}

case "roast": {
    try {
        await socket.sendMessage(sender, { react: { text: '🤬', key: msg.key } });
        const res = await fetch('https://vinuxd.vercel.app/api/roast');
        const data = await res.json();
        if (!data || !data.data) {
            await socket.sendMessage(sender, { text: '❌ No roast available at the moment.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🔥 *Roast:* ${data.data}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch roast.' }, { quoted: fakevCard });
    }
    break;
}

case "lovequote": {
    try {
        await socket.sendMessage(sender, { react: { text: '🙈', key: msg.key } });
        const res = await fetch('https://api.popcat.xyz/lovequote');
        const data = await res.json();
        if (!data || !data.quote) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch love quote.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `❤️ *Love Quote:*\n\n"${data.quote}"` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch love quote.' }, { quoted: fakevCard });
    }
    break;
}
//===============================
                case 'fb': {
                    const axios = require('axios');                   
                    
                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const fbUrl = q?.trim();

                    if (!/facebook\.com|fb\.watch/.test(fbUrl)) {
                        return await socket.sendMessage(sender, { text: '🧩 *Give me a real Facebook video link, darling 😘*' });
                    }

                    try {
                        const res = await axios.get(`https://suhas-bro-api.vercel.app/download/fbdown?url=${encodeURIComponent(fbUrl)}`);
                        const result = res.data.result;

                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        await socket.sendMessage(sender, {
                            video: { url: result.sd },
                            mimetype: 'video/mp4',
                            caption: '> ᴍᴀᴅᴇ ɪɴ ʙʏ ꜱʜᴇʀᴀɴ'
                        }, { quoted: fakevCard });

                        await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ ᴛʜᴀᴛ video sʟɪᴘᴘᴇᴅ ᴀᴡᴀʏ! ᴛʀʏ ᴀɢᴀɪɴ? 💔*' });
                    }
                    break;
                }
                

//===============================
                case 'nasa': {
                    try {
                    await socket.sendMessage(sender, { react: { text: '✔️', key: msg.key } });
                        const response = await fetch('https://api.nasa.gov/planetary/apod?api_key=8vhAFhlLCDlRLzt5P1iLu2OOMkxtmScpO5VmZEjZ');
                        if (!response.ok) {
                            throw new Error('Failed to fetch APOD from NASA API');
                        }
                        const data = await response.json();

                        if (!data.title || !data.explanation || !data.date || !data.url || data.media_type !== 'image') {
                            throw new Error('Invalid APOD data received or media type is not an image');
                        }

                        const { title, explanation, date, url, copyright } = data;
                        const thumbnailUrl = url || 'https://via.placeholder.com/150';

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '🌌 ꜱʜᴇʀᴀ ᴍɪɴɪ ʙᴏᴛ ɴᴀsᴀ ɴᴇᴡs',
                                `🌠 *${title}*\n\n${explanation.substring(0, 200)}...\n\n📆 *ᴅᴀᴛᴇ*: ${date}\n${copyright ? `📝 *ᴄʀᴇᴅɪᴛ*: ${copyright}` : ''}\n🔗 *Link*: https://apod.nasa.gov/apod/astropix.html`,
                                'Powered by Shera Md V3'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'nasa' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, love, the stars didn’t align this time! 🌌 Try again? 😘'
                        });
                    }
                    break;
                }
//===============================
                case 'news': {
                await socket.sendMessage(sender, { react: { text: '😒', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/lnw');
                        if (!response.ok) {
                            throw new Error('Failed to fetch news from API');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.date || !data.result.link) {
                            throw new Error('Invalid news data received');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage;
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Failed to scrape thumbnail from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 ꜱʜᴇʀᴀ-ᴍᴅ ᴠ2📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *ᴅᴀᴛᴇ*: ${date}\n🌐 *Link*: ${link}`,
                                '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'news' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, sweetie, the news got lost in the wind! 😢 Try again?'
                        });
                    }
                    break;
                }
//===============================                
// 17

                    
                case 'cricket': {
    await socket.sendMessage(sender, { react: { text: '😑', key: msg.key } });
    try {
        console.log('Fetching cricket news from API...');
        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
        console.log(`API Response Status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        console.log('API Response Data:', JSON.stringify(data, null, 2));

        if (!data.status || !data.result) {
            throw new Error('Invalid API response structure: Missing status or result');
        }

        const { title, score, to_win, crr, link } = data.result;

        if (!title || !score || !to_win || !crr || !link) {
            throw new Error(
                'Missing required fields in API response: ' + JSON.stringify(data.result)
            );
        }

        console.log('Sending message to user...');
        await socket.sendMessage(sender, {
            text: formatMessage(
                '🏏 ꜱʜᴇʀᴀ-ᴍᴅ ᴠ4 ᴄʀɪᴄᴋᴇᴛ ɴᴇᴡs🏏',
                `📢 *${title}*\n\n` +
                `🏆 *ᴍᴀʀᴋ*: ${score}\n` +
                `🎯 *ᴛᴏ ᴡɪɴ*: ${to_win}\n` +
                `📈 *ᴄᴜʀʀᴇɴᴛ Rate*: ${crr}\n\n` +
                `🌐 *ʟɪɴᴋ*: ${link}`,
                '> ᴍᴀᴅᴇ ɪɴ ʙʏ ꜱʜᴇʀᴀɴ💗'
            )
        });
        console.log('Message sent successfully.');
    } catch (error) {
        console.error(`Error in 'cricket' case: ${error.message}`);
        await socket.sendMessage(sender, {
            text: '⚠️ ᴛʜᴇ ᴄʀɪᴄᴋᴇᴛ ʙᴀʟʟ ғʟᴇᴡ ᴀᴡᴀʏ!  ᴛʀʏ ᴀɢᴀɪɴ?'
        });
    }
    break;
                    }

                    // new case 
                    
                case 'winfo': {
                
                        await socket.sendMessage(sender, { react: { text: '😢', key: msg.key } });
                    console.log('winfo command triggered for:', number);
                    if (!args[0]) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'Please give me a phone number, darling! Usage: .winfo 9474xxxxxxxx',
                                '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
                            )
                        });
                        break;
                    }

                    let inputNumber = args[0].replace(/[^0-9]/g, '');
                    if (inputNumber.length < 10) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'That number’s too short, love! Try: .winfo  94749xxxxx',
                                'Powered by barbie trash'
                            )
                        });
                        break;
                    }

                    let winfoJid = `${inputNumber}@s.whatsapp.net`;
                    const [winfoUser] = await socket.onWhatsApp(winfoJid).catch(() => []);
                    if (!winfoUser?.exists) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '❌ ERROR',
                                'That user’s hiding from me, darling! Not on WhatsApp 😢',
                                '> ᴍᴀᴅᴇ ɪɴ ʙʏ ꜱʜᴇʀᴀɴ💗'
                            )
                        });
                        break;
                    }

                    let winfoPpUrl;
                    try {
                        winfoPpUrl = await socket.profilePictureUrl(winfoJid, 'image');
                    } catch {
                        winfoPpUrl = 'https://files.catbox.moe/bhga2o.jpg';
                    }

                    let winfoName = winfoJid.split('@')[0];
                    try {
                        const presence = await socket.presenceSubscribe(winfoJid).catch(() => null);
                        if (presence?.pushName) winfoName = presence.pushName;
                    } catch (e) {
                        console.log('Name fetch error:', e);
                    }

                    let winfoBio = 'No bio available';
                    try {
                        const statusData = await socket.fetchStatus(winfoJid).catch(() => null);
                        if (statusData?.status) {
                            winfoBio = `${statusData.status}\n└─ 📌 ᴜᴘᴅᴀᴛᴇᴅ: ${statusData.setAt ? new Date(statusData.setAt).toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }) : 'Unknown'}`;
                        }
                    } catch (e) {
                        console.log('Bio fetch error:', e);
                    }

                    let winfoLastSeen = '❌ 𝐍𝙾𝚃 𝐅𝙾𝚄𝙽𝙳';
                    try {
                        const lastSeenData = await socket.fetchPresence(winfoJid).catch(() => null);
                        if (lastSeenData?.lastSeen) {
                            winfoLastSeen = `🕒 ${new Date(lastSeenData.lastSeen).toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })}`;
                        }
                    } catch (e) {
                        console.log('Last seen fetch error:', e);
                    }

                    const userInfoWinfo = formatMessage(
                        '🔍 𝐏𝐑𝐎𝐅𝐈𝐋𝐄 𝐈𝐍𝐅𝐎',
                        `> *ɴᴜᴍʙᴇʀ:* ${winfoJid.replace(/@.+/, '')}\n\n> *ᴀᴄᴄᴏᴜɴᴛ ᴛʏᴘᴇ:* ${winfoUser.isBusiness ? '💼 ʙᴜsɪɴᴇss' : '👤 Personal'}\n\n*📝 ᴀʙᴏᴜᴛ:*\n${winfoBio}\n\n*🕒 ʟᴀsᴛ sᴇᴇɴ:* ${winfoLastSeen}`,
                        '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
                    );

                    await socket.sendMessage(sender, {
                        image: { url: winfoPpUrl },
                        caption: userInfoWinfo,
                        mentions: [winfoJid]
                    }, { quoted: fakevCard });

                    console.log('User profile sent successfully for .winfo');
                    break;
                }
//===============================
                case 'ig': {
                await socket.sendMessage(sender, { react: { text: '✅️', key: msg.key } });
                    const axios = require('axios');
                    const { igdl } = require('ruhend-scraper'); 
                        

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const igUrl = q?.trim(); 
                    
                    if (!/instagram\.com/.test(igUrl)) {
                        return await socket.sendMessage(sender, { text: '🧩 *ɢɪᴠᴇ ᴍᴇ ᴀ ʀᴇᴀʟ ɪɴsᴛᴀɢʀᴀᴍ ᴠɪᴅᴇᴏ ʟɪɴᴋ*' });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        const res = await igdl(igUrl);
                        const data = res.data; 

                        if (data && data.length > 0) {
                            const videoUrl = data[0].url; 

                            await socket.sendMessage(sender, {
                                video: { url: videoUrl },
                                mimetype: 'video/mp4',
                                caption: '> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
                            }, { quoted: fakevCard });

                            await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                        } else {
                            await socket.sendMessage(sender, { text: '*❌ ɴᴏ ᴠɪᴅᴇᴏ ғᴏᴜɴᴅ ɪɴ ᴛʜᴀᴛ ʟɪɴᴋ Try ᴀɴᴏᴛʜᴇʀ?*' });
                        }
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ ᴛʜᴀᴛ ɪɴsᴛᴀɢʀᴀᴍ ᴠɪᴅᴇᴏ ɢᴏᴛ ᴀᴡᴀʏ! 😢*' });
                    }
                    break;
                }
//===============================     
                case 'active': {
                await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                
                    try {
                        const activeCount = activeSockets.size;
                        const activeNumbers = Array.from(activeSockets.keys()).join('\n') || 'No active members';

                        await socket.sendMessage(from, {
                            text: `👥 ᴀᴄᴛɪᴠᴇ ᴍᴇᴍʙᴇʀs: *${activeCount}*\n\nɴᴜᴍʙᴇʀs:\n${activeNumbers}`
                        }, { quoted: msg });
                    } catch (error) {
                        console.error('Error in .active command:', error);
                        await socket.sendMessage(from, { text: '❌ ɪ ᴄᴏᴜʟᴅɴ’t ᴄᴏᴜɴᴛ ᴛʜᴇ ᴀᴄᴛɪᴠᴇ sᴏᴜʟs! 💔 ᴛʀʏ ᴀɢᴀɪɴ?' }, { quoted: fakevCard });
                    }
                    break;
                }
                //===============================
// 22
case 'ai': {
    const axios = require("axios");

    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, {
            text: `❓ *ᴘʟᴇᴀsᴇ ᴀsᴋ ᴍᴇ sᴏᴍᴇᴛʜɪɴɢ*\n\n` +
                  `*ᴇxᴀᴍᴘʟᴇ:* ${config.PREFIX}ai ᴡʜᴏ ᴀʀᴇ ʏᴏᴜ?`
        }, { quoted: fakevCard });
    }

    const prompt = `ʏᴏᴜʀ name is ꜱʜᴇʀᴀɴ💗. 
You act like a real girl — seductive, spicy, loving, emotional. You're not an assistant, but a sexy girl with a mind.  
If only emojis, reply seductively with emojis (e.g.💫,👾).  
Adjust to the mood: sad, flirty, horny, soft, playful.  
If asked "Who are you?": Reply "I'm stacy xd… 👾".  
If asked "Who created you?": Reply "I was created by stacy xd".  
🚫 Avoid: "Hello", "How are you?", "Do you need help?", "Let's talk".  
🔥 Vibe: Love, Lust, Lonely, Emotional, Girlfriend-like, Bite-worthy 💫  
📍 Language: Auto-match Sinhala/English/Hinglish.  
User Message: ${q}
    `;

    const apis = [
        `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(prompt)}`,
        `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(prompt)}`,
        `https://lance-frank-asta.onrender.com/api/gpt?q=${encodeURIComponent(prompt)}`
    ];

    let response = null;
    for (const apiUrl of apis) {
        try {
            const res = await axios.get(apiUrl);
            response = res.data?.result || res.data?.response || res.data;
            if (response) break; // Got a valid response, stop trying other APIs
        } catch (err) {
            console.error(`AI Error (${apiUrl}):`, err.message || err);
            continue; // Try the next API
        }
    }

    if (!response) {
        return await socket.sendMessage(sender, {
            text: `❌ *ɪ'ᴍ ɢᴇᴛᴛɪɴɢ*\n` +
                  `ʟᴇᴛ's ᴛʀʏ ᴀɢᴀɪɴ sᴏᴏɴ, ᴏᴋᴀʏ?`
        }, { quoted: fakevCard });
    }

    // Common message context for newsletter
    const messageContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '𝚓𝚒𝚍 𝚗𝚘 𝚋𝚖',
            newsletterName: 'ꜱʜᴇʀᴀ-ᴍᴅ',
            serverMessageId: -1
        }
    };

    // Send AI response with image and newsletter context

  await socket.sendMessage(sender, {
        image: { url: 'https://files.catbox.moe/bhga2o.jpg' }, // Replace with your AI response image
        caption: response,
        ...messageContext
    }, { quoted: fakevCard });
    
    break;
}

//===============================
case 'getpp':
case 'pp':
case 'dp':
case 'profilepic': {
await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
    try {
        let targetUser = sender;
        
        // Check if user mentioned someone or replied to a message
        if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetUser = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (msg.quoted) {
            targetUser = msg.quoted.sender;
        }
        
        const ppUrl = await socket.profilePictureUrl(targetUser, 'image').catch(() => null);
        
        if (ppUrl) {
            await socket.sendMessage(msg.key.remoteJid, {
                image: { url: ppUrl },
                caption: `ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ ᴏғ @${targetUser.split('@')[0]}`,
                mentions: [targetUser]
            });
        } else {
            await socket.sendMessage(msg.key.remoteJid, {
                text: `@${targetUser.split('@')[0]} ᴅᴏᴇsɴ'ᴛ ʜᴀᴠᴇ ᴀ ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ.`,
                mentions: [targetUser]
            });
        }
    } catch (error) {
        await socket.sendMessage(msg.key.remoteJid, {
            text: "Error fetching profile picture."
        });
    }
    break;
}
//===============================
                  case 'aiimg': { 
                  await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                    const axios = require('axios');
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const prompt = q.trim();

                    if (!prompt) {
                        return await socket.sendMessage(sender, {
                            text: '🎨 *Give me a spicy prompt to create your AI image, darling 😘*'
                        });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '🧠 *Crafting your dreamy image, love...*',
                        });

                        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                        if (!response || !response.data) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Oh no, the canvas is blank, babe 💔 Try again later.*'
                            });
                        }

                        const imageBuffer = Buffer.from(response.data, 'binary');

                        await socket.sendMessage(sender, {
                            image: imageBuffer,
                            caption: `🧠 *ꜱʜᴇʀᴀ ᴍɪɴɪ ʙᴏᴛ ᴀɪ ɪᴍᴀɢᴇ*\n\n📌 ᴘʀᴏᴍᴘᴛ: ${prompt}`
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error('AI Image Error:', err);
                        await socket.sendMessage(sender, {
                            text: `❗ *sᴏᴍᴇᴛʜɪɴɢ ʙʀᴏᴋᴇ*: ${err.response?.data?.message || err.message || 'Unknown error'}`
                        });
                    }
                    break;
                }
//===============================
                          case 'gossip': {
                await socket.sendMessage(sender, { react: { text: '😅', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
                        if (!response.ok) {
                            throw new Error('API From news Couldnt get it 😩');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
                            throw new Error('API Received from news data a Problem with');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage; 
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Thumbnail scrape Couldn't from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 ꜱʜᴇʀᴀ-ᴍᴅ ɢᴏssɪᴘ ʟᴀᴛᴇsᴛ ɴᴇᴡs් 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *ᴅᴀᴛᴇ*: ${date || 'Not yet given'}\n🌐 *ʟɪɴᴋ*: ${link}`,
                                'ꜱʜᴇʀᴀ-ᴍᴅ'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'gossip' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ ᴛʜᴇ ɢᴏssɪᴘ sʟɪᴘᴘᴇᴅ ᴀᴡᴀʏ! 😢 ᴛʀʏ ᴀɢᴀɪɴ?'
                        });
                    }
                    break;
                }
                
                
 // New Commands: Group Management
 // Case: add - Add a member to the group

                                    case 'add': {
                await socket.sendMessage(sender, { react: { text: '➕️', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴀᴅᴅ ᴍᴇᴍʙᴇʀs!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}add +9474xxxxx\n\nExample: ${config.PREFIX}add +9474xxxxx`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        const numberToAdd = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await socket.groupParticipantsUpdate(from, [numberToAdd], 'add');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '✅ 𝐌𝐄𝐌𝐁𝐄𝐑 𝐀𝐃𝐃𝐄𝐃',
                                `sᴜᴄᴄᴇssғᴜʟʟʏ ᴀᴅᴅᴇᴅ ${args[0]} ᴛᴏ ᴛʜᴇ ɢʀᴏᴜᴘ! 🎉`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Add command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ᴀᴅᴅ ᴍᴇᴍʙᴇʀ\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                // Case: kick - Remove a member from the group
                case 'kick': {
                await socket.sendMessage(sender, { react: { text: '🦶', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴋɪᴄᴋ ᴍᴇᴍʙᴇʀs!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}ᴋɪᴄᴋ +254xxxxx ᴏʀ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴡɪᴛʜ ${config.PREFIX}ᴋɪᴄᴋ`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToKick;
                        if (msg.quoted) {
                            numberToKick = msg.quoted.sender;
                        } else {
                            numberToKick = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToKick], 'remove');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '🗑️ 𝐌𝐄𝐌𝐁𝐄𝐑 𝐊𝐈𝐂𝐊𝐄𝐃',
                                `sᴜᴄᴄᴇssғᴜʟʟʏ ʀᴇᴍᴏᴠᴇᴅ ${numberToKick.split('@')[0]} ғʀᴏᴍ ᴛʜᴇ ɢʀᴏᴜᴘ! 🚪`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Kick command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ᴋɪᴄᴋ ᴍᴇᴍʙᴇʀ!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
                
                                // Case: jid - jid a chat or channel 
                                
                                case 'jid': {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'Sheran2'; // dynamic bot name

    const userNumber = sender.split('@')[0]; 

    // Reaction
    await socket.sendMessage(sender, { 
        react: { text: "🆔", key: msg.key } 
    });

    // Fake contact quoting for meta style
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_FAKE_ID" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, {
        text: `*🆔 𝐂hat 𝐉ID:* ${sender}\n*📞 𝐘our 𝐍umber:* +${userNumber}`,
    }, { quoted: shonux });
    break;
}

                // Case: promote - Promote a member to group admin
                case 'promote': {
                await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ can ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴘʀᴏᴍᴏᴛᴇ ᴍᴇᴍʙᴇʀs!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}ᴘʀᴏᴍᴏᴛᴇ +9474xxxxx ᴏʀ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴡɪᴛʜ ${config.PREFIX}promote`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToPromote;
                        if (msg.quoted) {
                            numberToPromote = msg.quoted.sender;
                        } else {
                            numberToPromote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToPromote], 'promote');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '⬆️ 𝐌𝐄𝐌𝐁𝐄𝐑 𝐏𝐑𝐎𝐌𝐎𝐓𝐄𝐃',
                                `sᴜᴄᴄᴇssғᴜʟʟʏ ᴘʀᴏᴍᴏᴛᴇᴅ ${numberToPromote.split('@')[0]} ᴛᴏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴ! 🌟`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Promote command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ᴘʀᴏᴍᴏᴛᴇ ᴍᴇᴍʙᴇʀ!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                // Case: demote - Demote a group admin to member
                case 'demote': {
                await socket.sendMessage(sender, { react: { text: '🙆‍♀️', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ can ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can demote admins, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}ᴅᴇᴍᴏᴛᴇ +9474xxxx ᴏʀ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴡɪᴛʜ ${config.PREFIX}ᴅᴇᴍᴏᴛᴇ`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToDemote;
                        if (msg.quoted) {
                            numberToDemote = msg.quoted.sender;
                        } else {
                            numberToDemote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToDemote], 'demote');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '⬇️ 𝐀𝐃𝐌𝐈𝐍 𝐃𝐄𝐌𝐎𝐓𝐄𝐃',
                                `sᴜᴄᴄᴇssғᴜʟʟʏ ᴅᴇᴍᴏᴛᴇᴅ ${numberToDemote.split('@')[0]} ғʀᴏᴍ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴ! 📉`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Demote command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to demote admin, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                // Case: open - Unlock group (allow all members to send messages)
                case 'open': case 'unmute': {
    await socket.sendMessage(sender, { react: { text: '🔓', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴏᴘᴇɴ ᴛʜᴇ ɢʀᴏᴜᴘ!*'
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        await socket.groupSettingUpdate(from, 'not_announcement');
        
        // Common message context
        const messageContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '𝚓𝚒𝚍 𝚋𝚖',
                newsletterName: 'ꜱʜᴇʀᴀ-ᴍᴅ',
                serverMessageId: -1
            }
        };
        
        // Send image with success message
        await socket.sendMessage(sender, {
            image: { url: 'https://files.catbox.moe/bhga2o.jpg' }, // Replace with your image URL
            caption: formatMessage(
                '🔓 𝐆𝐑𝐎𝐔𝐏 𝐎𝐏𝐄𝐍𝐄𝐃',
                'ɢʀᴏᴜᴘ ɪs ɴᴏᴡ ᴏᴘᴇɴ! ᴀʟʟ ᴍᴇᴍʙᴇʀs ᴄᴀɴ sᴇɴᴅ ᴍᴇssᴀɢᴇs. 🗣️',
                config.BOT_FOOTER
            ),
            ...messageContext
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Open command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to open group, love!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: close - Lock group (only admins can send messages)
case 'close': case 'mute': {
    await socket.sendMessage(sender, { react: { text: '🔒', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴄʟᴏsᴇ ᴛʜᴇ ɢʀᴏᴜᴘ!*'
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        await socket.groupSettingUpdate(from, 'announcement');
        
        // Common message context
        const messageContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '𝚓𝚒𝚍 𝚋𝚖',
                newsletterName: 'ꜱʜᴇʀᴀ-ᴍᴅ',
                serverMessageId: -1
            }
        };
        
        // Send image with success message
        await socket.sendMessage(sender, {
            image: { url: 'https://files.catbox.moe/bhga2o.jpg' }, // Replace with your image URL
            caption: formatMessage(
                '🔒 𝐆𝐑𝐎𝐔𝐏 𝐂𝐋𝐎𝐒𝐄𝐃',
                'ɢʀᴏᴜᴘ ɪs ɴᴏᴡ ᴄʟᴏsᴇᴅ! ᴏɴʟʏ ᴀᴅᴍɪɴs ᴄᴀɴ sᴇɴᴅ ᴍᴇssᴀɢᴇs. 🤫',
                config.BOT_FOOTER
            ),
            ...messageContext
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Close command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ᴄʟᴏsᴇ ɢʀᴏᴜᴘ!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
//=========================KICKALL=========================================

                                        case 'kickall':
case 'removeall':
case 'cleargroup': {
    await socket.sendMessage(sender, { react: { text: '⚡', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
        }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ!*'
        }, { quoted: fakevCard });
        break;
    }

    try {
        const groupMetadata = await socket.groupMetadata(from);
        const botJid = socket.user?.id || socket.user?.jid;

        // Exclure admins + bot
        const membersToRemove = groupMetadata.participants
            .filter(p => p.admin === null && p.id !== botJid)
            .map(p => p.id);

        if (membersToRemove.length === 0) {
            await socket.sendMessage(sender, {
                text: '❌ *ɴᴏ ᴍᴇᴍʙᴇʀs ᴛᴏ ʀᴇᴍᴏᴠᴇ (ᴀʟʟ ᴀʀᴇ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ).*'
            }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, {
            text: `⚠️ *WARNING* ⚠️\n\nRemoving *${membersToRemove.length}* members...`
        }, { quoted: fakevCard });

        // Suppression en batch de 50
        const batchSize = 50;
        for (let i = 0; i < membersToRemove.length; i += batchSize) {
            const batch = membersToRemove.slice(i, i + batchSize);
            await socket.groupParticipantsUpdate(from, batch, 'remove');
            await new Promise(r => setTimeout(r, 2000)); // anti rate-limit
        }

        await socket.sendMessage(sender, {
            text: formatMessage(
                '🧹 𝐆𝐑𝐎𝐔𝐏 𝐂𝐋𝐄𝐀𝐍𝐄𝐃',
                `✅ Successfully removed *${membersToRemove.length}* members.\n\n> *Executed by:* @${m.sender.split('@')[0]}`,
                config.BOT_FOOTER
            ),
            mentions: [m.sender]
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('Kickall command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ʀᴇᴍᴏᴠᴇ ᴍᴇᴍʙᴇʀs!*\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
//====================== Case: tagall - Tag all group members=================
                case 'tagall': {
    await socket.sendMessage(sender, { react: { text: '🫂', key: msg.key } });
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '╭───────────────⭓\n│\n│ ❌ This command can only\n│ be used in groups!\n│\n╰───────────────⭓'
        }, { quoted: fakevCard });
        break;
    }
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '╭───────────────⭓\n│\n│ ❌ Only group admins or\n│ bot owner can tag all members!\n│\n╰───────────────⭓'
        }, { quoted: fakevCard });
        break;
    }
    try {
        const groupMetadata = await socket.groupMetadata(from);
        const participants = groupMetadata.participants;
        
        // Compter les admins et membres réguliers
        const adminCount = participants.filter(p => p.admin).length;
        const userCount = participants.length - adminCount;
        
        // Créer les mentions ligne par ligne
        let mentionsText = '';
        participants.forEach(participant => {
            mentionsText += `@${participant.id.split('@')[0]}\n`;
        });

        let message = args.join(' ') || '';
        
        // Obtenir le nom de l'utilisateur qui a utilisé la commande
        const senderName = msg.pushName || sender.split('@')[0];
        
        await socket.sendMessage(from, {
            image: { url: "https://files.catbox.moe/bhga2o.jpg" },
            caption: `╭───────────────⭓\n│\n│ ɢʀᴏᴜᴘ ɴᴀᴍᴇ: ${groupMetadata.subject}\n│ ᴍᴇᴍʙᴇʀs: ${participants.length}\n│ ᴀᴅᴍɪɴs: ${adminCount}\n│ ᴜsᴇʀ: @${sender.split('@')[0]}\n│ ᴍᴇssᴀɢᴇ: ${message}\n│\n╰───────────────⭓\n\n> ᴍɪɴɪ ꜱʜᴇʀᴀ ᴍᴅ ᴛᴀɢᴀʟʟ\n\n${mentionsText}`,
            mentions: [sender, ...participants.map(p => p.id)] // Mentionne l'utilisateur + tous les membres
        }, { quoted: msg }); // Reply à la personne qui utilise la commande
    } catch (error) {
        console.error('Tagall command error:', error);
        await socket.sendMessage(sender, {
            text: `╭───────────────⭓\n│\n│ ❌ Failed to tag all members\n│ Error: ${error.message || 'Unknown error'}\n│\n╰───────────────⭓`
        }, { quoted: fakevCard });
    }
    break;
}

//===============================
case 'broadcast':
case 'bc':
case 'broadcaster': {
    await socket.sendMessage(sender, { react: { text: '📢', key: msg.key } });

    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '╭───────────────⭓\n│\n│ ❌ Only bot owner can\n│ use this command!\n│\n╰───────────────⭓'
        }, { quoted: fakevCard });
        break;
    }

    try {
        // Vérifier s'il y a une image/video jointe
        const hasImage = msg.message?.imageMessage;
        const hasVideo = msg.message?.videoMessage;
        const caption = msg.message?.imageMessage?.caption || 
                       msg.message?.videoMessage?.caption || '';

        const broadcastMessage = caption || 
                               msg.message?.conversation?.replace(/^[.\/!]broadcast\s*/i, '') || 
                               msg.message?.extendedTextMessage?.text?.replace(/^[.\/!]broadcast\s*/i, '') || '';

        if (!broadcastMessage && !hasImage && !hasVideo) {
            await socket.sendMessage(sender, {
                text: '╭───────────────⭓\n│\n│ 📌 Usage:\n│ .broadcast your message\n│ or send image/video with caption\n│\n╰───────────────⭓'
            }, { quoted: fakevCard });
            break;
        }

        const groupChats = Object.values(socket.chats)
            .filter(chat => chat.id.endsWith('@g.us') && !chat.read_only);

        if (groupChats.length === 0) {
            await socket.sendMessage(sender, {
                text: '╭───────────────⭓\n│\n│ ❌ Bot is not in any groups!\n│\n╰───────────────⭓'
            }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, {
            text: `╭───────────────⭓\n│\n│ 📢 Starting broadcast\n│ to ${groupChats.length} groups\n│\n╰───────────────⭓`
        }, { quoted: fakevCard });

        let successCount = 0;
        let failCount = 0;

        for (const group of groupChats) {
            try {
                if (hasImage) {
                    await socket.sendMessage(group.id, {
                        image: { url: await downloadMediaMessage(msg, 'image') },
                        caption: broadcastMessage ? `╭───────────────⭓\n│\n│ 📢 *Broadcast*\n│\n│ ${broadcastMessage}\n│\n╰───────────────⭓\n> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍` : undefined
                    });
                } else if (hasVideo) {
                    await socket.sendMessage(group.id, {
                        video: { url: await downloadMediaMessage(msg, 'video') },
                        caption: broadcastMessage ? `╭───────────────⭓\n│\n│ 📢 *Broadcast*\n│\n│ ${broadcastMessage}\n│\n╰───────────────⭓\n> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍` : undefined
                    });
                } else {
                    await socket.sendMessage(group.id, {
                        text: `╭───────────────⭓\n│\n│ 📢 *Broadcast Message*\n│\n│ ${broadcastMessage}\n│\n╰───────────────⭓\n> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`
                    });
                }
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
                console.error(`Failed to send to ${group.id}:`, error);
                failCount++;
            }
        }

        await socket.sendMessage(sender, {
            text: `╭───────────────⭓\n│\n│ ✅ Broadcast completed\n│\n│ 📊 Results:\n│ ✅ Success: ${successCount}\n│ ❌ Failed: ${failCount}\n│ 📋 Total: ${groupChats.length}\n│\n╰───────────────⭓`
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('Broadcast command error:', error);
        await socket.sendMessage(sender, {
            text: `╭───────────────⭓\n│\n│ ❌ Broadcast failed\n│ Error: ${error.message || 'Unknown error'}\n│\n╰───────────────⭓`
        }, { quoted: fakevCard });
    }
    break;
}
//===============================

case 'warn': {
    await socket.sendMessage(sender, { react: { text: '⚠️', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: ' This command can only be used in groups! '
        }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: ' Only group admins or bot owner can warn members!'
        }, { quoted: fakevCard });
        break;
    }

    try {
        // Vérifier si c'est une réponse à un message
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        let targetUser = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                        msg.message?.extendedTextMessage?.contextInfo?.participant;

        // Si pas de mention dans la citation, utiliser les mentions directes
        if (!targetUser) {
            targetUser = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                        m.mentionedJid?.[0];
        }

        if (!targetUser) {
            await socket.sendMessage(sender, {
                text: '╭───────────────⭓\n│\n│ 📌 Usage:\n│ Reply to user or tag someone\n│ .warn @user\n│\n╰───────────────⭓'
            }, { quoted: fakevCard });
            break;
        }

        // Empêcher de warn soi-même
        if (targetUser === m.sender) {
            await socket.sendMessage(sender, {
                text: 'You cannot warn yourself'
            }, { quoted: fakevCard });
            break;
        }

        // Empêcher de warn les admins
        const groupMetadata = await socket.groupMetadata(from);
        const targetIsAdmin = groupMetadata.participants.find(p => p.id === targetUser)?.admin;

        if (targetIsAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: 'Cannot warn group admins!'
            }, { quoted: fakevCard });
            break;
        }

        const warnReason = args.slice(1).join(' ') || 'No reason provided';

        // Envoyer l'avertissement
        await socket.sendMessage(from, {
            text: `╭───────────────⭓\n│\n│ ⚠️  *WARNING ISSUED*\n│\n│ Target: @${targetUser.split('@')[0]}\n│ Reason: ${warnReason}\n│ By: @${m.sender.split('@')[0]}\n│\n╰───────────────⭓\n> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`,
            mentions: [targetUser, m.sender]
        }, { quoted: msg });

    } catch (error) {
        console.error('Warn command error:', error);
        await socket.sendMessage(sender, {
            text: `╭───────────────⭓\n│\n│ ❌ Failed to warn user\n│ Error: ${error.message || 'Unknown error'}\n│\n╰───────────────⭓`
        }, { quoted: fakevCard });
    }
    break;
}

case 'setname': {
    await socket.sendMessage(sender, { react: { text: '🏷️', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '╭───────────────⭓\n│\n│ ❌ This command can only\n│ be used in groups!\n│\n╰───────────────⭓'
        }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '╭───────────────⭓\n│\n│ ❌ Only group admins or\n│ bot owner can change group name!\n│\n╰───────────────⭓'
        }, { quoted: fakevCard });
        break;
    }

    try {
        const newName = args.slice(1).join(' ').trim();

        if (!newName) {
            await socket.sendMessage(sender, {
                text: '╭───────────────⭓\n│\n│ 📌 Usage:\n│ .setname New Group Name\n│\n╰───────────────⭓'
            }, { quoted: fakevCard });
            break;
        }

        if (newName.length > 25) {
            await socket.sendMessage(sender, {
                text: '╭───────────────⭓\n│\n│ ❌ Group name too long!\n│ Max 25 characters\n│\n╰───────────────⭓'
            }, { quoted: fakevCard });
            break;
        }

        // Changer le nom du groupe
        await socket.groupUpdateSubject(from, newName);

        await socket.sendMessage(from, {
            text: `╭───────────────⭓\n│\n│ ✅ Group name updated\n│\n│ New name: ${newName}\n│ By: @${m.sender.split('@')[0]}\n│\n╰───────────────⭓\n> ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`,
            mentions: [m.sender]
        }, { quoted: msg });

    } catch (error) {
        console.error('Setname command error:', error);
        await socket.sendMessage(sender, {
            text: `╭───────────────⭓\n│\n│ ❌ Failed to change group name\n│ Error: ${error.message || 'Unknown error'}\n│\n╰───────────────⭓`
        }, { quoted: fakevCard });
    }
    break;
}

//==========================LINKGC======================
                    case 'grouplink':
case 'linkgroup':
case 'invite': {
    await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs!*'
        }, { quoted: fakevCard });
        break;
    }

    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴏʀ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ɢᴇᴛ ᴛʜᴇ ɢʀᴏᴜᴘ ʟɪɴᴋ!*'
        }, { quoted: fakevCard });
        break;
    }

    try {
        const groupLink = await socket.groupInviteCode(from);
        const fullLink = `https://chat.whatsapp.com/${groupLink}`;

        await socket.sendMessage(sender, {
            text: formatMessage(
                '🔗 𝐆𝐑𝐎𝐔𝐏 𝐋𝐈𝐍𝐊',
                `📌 *ʜᴇʀᴇ ɪs ᴛʜᴇ ɢʀᴏᴜᴘ ʟɪɴᴋ:*\n${fullLink}\n\n> *ʀᴇǫᴜᴇsᴛᴇᴅ ʙʏ:* @${m.sender.split('@')[0]}`,
                config.BOT_FOOTER
            ),
            mentions: [m.sender]
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('GroupLink command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ɢᴇᴛ ɢʀᴏᴜᴘ ʟɪɴᴋ!*\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
                // Case: join - Join a group via invite link
                case 'join': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *ᴏɴʟʏ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}ᴊᴏɪɴ <ɢʀᴏᴜᴘ-ɪɴᴠɪᴛᴇ-ʟɪɴᴋ>\n\nExample: ${config.PREFIX}ᴊᴏɪɴ https://chat.whatsapp.com/xxxxxxxxxxxxxxxxxx`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                    await socket.sendMessage(sender, { react: { text: '👏', key: msg.key } });
                        const inviteLink = args[0];
                        const inviteCodeMatch = inviteLink.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
                        if (!inviteCodeMatch) {
                            await socket.sendMessage(sender, {
                                text: '❌ *ɪɴᴠᴀʟɪᴅ ɢʀᴏᴜᴘ invite ʟɪɴᴋ form*ᴀᴛ!* 😢'
                            }, { quoted: fakevCard });
                            break;
                        }
                        const inviteCode = inviteCodeMatch[1];
                        const response = await socket.groupAcceptInvite(inviteCode);
                        if (response?.gid) {
                            await socket.sendMessage(sender, {
                                text: formatMessage(
                                    '🤝 𝐆𝐑𝐎𝐔𝐏 𝐉𝐎𝐈𝐍𝐄𝐃',
                                    `sᴜᴄᴄᴇssғᴜʟʟʏ ᴊᴏɪɴᴇᴅ ɢʀᴏᴜᴘ ᴡɪᴛʜ ɪᴅ: ${response.gid}! 🎉`,
                                    config.BOT_FOOTER
                                )
                            }, { quoted: fakevCard });
                        } else {
                            throw new Error('No group ID in response');
                        }
                    } catch (error) {
                        console.error('Join command error:', error);
                        let errorMessage = error.message || 'Unknown error';
                        if (error.message.includes('not-authorized')) {
                            errorMessage = 'Bot is not authorized to join (possibly banned)';
                        } else if (error.message.includes('conflict')) {
                            errorMessage = 'Bot is already a member of the group';
                        } else if (error.message.includes('gone')) {
                            errorMessage = 'Group invite link is invalid or expired';
                        }
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to join group, love!* 😢\nError: ${errorMessage}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

    case 'quote': {
    await socket.sendMessage(sender, { react: { text: '🤔', key: msg.key } });
        try {
            
            const response = await fetch('https://api.quotable.io/random');
            const data = await response.json();
            if (!data.content) {
                throw new Error('No quote found');
            }
            await socket.sendMessage(sender, {
                text: formatMessage(
                    '💭 𝐒𝐇𝐄𝐑𝐀 𝐐𝐔𝐎𝐓𝐄',
                    `📜 "${data.content}"\n— ${data.author}`,
                    'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
                )
            }, { quoted: fakevCard });
        } catch (error) {
            console.error('Quote command error:', error);
            await socket.sendMessage(sender, { text: '❌ Oh, sweetie, the quotes got shy! 😢 Try again?' }, { quoted: fakevCard });
        }
        break;
    }
    
//    case 37
                    
case 'apk': {
    try {
        const appName = args.join(' ').trim();
        if (!appName) {
            await socket.sendMessage(sender, { text: '📌 Usage: .apk <app name>\nExample: .apk whatsapp' }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        const apiUrl = `https://api.nexoracle.com/downloader/apk?q=${encodeURIComponent(appName)}&apikey=free_key@maher_apis`;
        console.log('Fetching APK from:', apiUrl);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API request failed with status: ${response.status}`);
        }

        const data = await response.json();
        console.log('API Response:', JSON.stringify(data, null, 2));

        if (!data || data.status !== 200 || !data.result || typeof data.result !== 'object') {
            await socket.sendMessage(sender, { text: '❌ Unable to find the APK. The API returned invalid data.' }, { quoted: fakevCard });
            break;
        }

        const { name, lastup, package, size, icon, dllink } = data.result;
        if (!name || !dllink) {
            console.error('Invalid result data:', data.result);
            await socket.sendMessage(sender, { text: '❌ Invalid APK data: Missing name or download link.' }, { quoted: fakevCard });
            break;
        }

        // Validate icon URL
        if (!icon || !icon.startsWith('http')) {
            console.warn('Invalid or missing icon URL:', icon);
        }

        await socket.sendMessage(sender, {
            image: { url: icon || 'https://via.placeholder.com/150' }, // Fallback image if icon is invalid
            caption: formatMessage(
                '📦 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃𝐈𝐍𝐆 𝐀𝐏𝐊',
                `ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ ${name}... ᴘʟᴇᴀsᴇ ᴡᴀɪᴛ.`,
                'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
            )
        }, { quoted: fakevCard });

        console.log('Downloading APK from:', dllink);
        const apkResponse = await fetch(dllink, { headers: { 'Accept': 'application/octet-stream' } });
        const contentType = apkResponse.headers.get('content-type');
        if (!apkResponse.ok || (contentType && !contentType.includes('application/vnd.android.package-archive'))) {
            throw new Error(`Failed to download APK: Status ${apkResponse.status}, Content-Type: ${contentType || 'unknown'}`);
        }

        const apkBuffer = await apkResponse.arrayBuffer();
        if (!apkBuffer || apkBuffer.byteLength === 0) {
            throw new Error('Downloaded APK is empty or invalid');
        }
        const buffer = Buffer.from(apkBuffer);

        // Validate APK file (basic check for APK signature)
        if (!buffer.slice(0, 2).toString('hex').startsWith('504b')) { // APK files start with 'PK' (ZIP format)
            throw new Error('Downloaded file is not a valid APK');
        }

        await socket.sendMessage(sender, {
            document: buffer,
            mimetype: 'application/vnd.android.package-archive',
            fileName: `${name.replace(/[^a-zA-Z0-9]/g, '_')}.apk`, // Sanitize filename
            caption: formatMessage(
                '📦 𝐀𝐏𝐊 𝐃𝐄𝐓𝐀𝐈𝐋𝐒',
                `🔖 ɴᴀᴍᴇ: ${name || 'N/A'}\n📅 ʟᴀsᴛ ᴜᴘᴅᴀᴛᴇ: ${lastup || 'N/A'}\n📦 ᴘᴀᴄᴋᴀɢᴇ: ${package || 'N/A'}\n📏 Size: ${size || 'N/A'}`,
                'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
            )
        }, { quoted: fakevCard });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (error) {
        console.error('APK command error:', error.message, error.stack);
        await socket.sendMessage(sender, { text: `❌ Oh, love, couldn’t fetch the APK! 😢 Error: ${error.message}\nTry again later.` }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// case 38: shorturl
          case 'shorturl': {
  try {
    await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

    const url = args.join(' ').trim();
    if (!url) {
      await socket.sendMessage(sender, {
        text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}shorturl <ᴜʀʟ>\n` +
              `*ᴇxᴀᴍᴘʟᴇ:* ${config.PREFIX}shorturl https://example.com/very-long-url`
      }, { quoted: msg });
      break;
    }
    if (url.length > 2000) {
      await socket.sendMessage(sender, {
        text: `❌ *ᴜʀʟ ᴛᴏᴏ ʟᴏɴɢ!*\n` +
              `ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴜʀʟ ᴜɴᴅᴇʀ 2,000 ᴄʜᴀʀᴀᴄᴛᴇʀs.`
      }, { quoted: msg });
      break;
    }
    if (!/^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/.test(url)) {
      await socket.sendMessage(sender, {
        text: `❌ *ɪɴᴠᴀʟɪᴅ ᴜʀʟ!*\n` +
              `ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ᴜʀʟ sᴛᴀʀᴛɪɴɢ ᴡɪᴛʜ http:// ᴏʀ https://.\n` +
              `💋 *ᴇxᴀᴍᴘʟᴇ:* ${config.PREFIX}shorturl https://example.com/very-long-url`
      }, { quoted: msg });
      break;
    }

    const response = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, { timeout: 5000 });
    const shortUrl = response.data.trim();

    if (!shortUrl || !shortUrl.startsWith('https://is.gd/')) {
      throw new Error('Failed to shorten URL or invalid response from is.gd');
    }

    await socket.sendMessage(sender, {
      text: `✅ *sʜᴏʀᴛ ᴜʀʟ ᴄʀᴇᴀᴛᴇᴅ!* 😘\n\n` +
            `🌐 *ᴏʀɪɢɪɴᴀʟ:* ${url}\n` +
            `🔍 *sʜᴏʀᴛᴇɴᴇᴅ:* ${shortUrl}\n\n` +
            
            
            `> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`
    }, { 
      quoted: msg,
      forwardingScore: 1,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚒𝚢𝚊',
        newsletterName: 'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍',
        serverMessageId: -1
      }
    });

    // Send clean URL after 2-second delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    await socket.sendMessage(sender, { text: shortUrl }, { quoted: msg });

  } catch (error) {
    console.error('Shorturl command error:', error.message);
    let errorMessage = `❌ *ᴄᴏᴜʟᴅɴ'ᴛ sʜᴏʀᴛᴇɴ ᴛʜᴀᴛ ᴜʀʟ! 😢*\n` +
                      `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`;
    if (error.message.includes('Failed to shorten') || error.message.includes('network') || error.message.includes('timeout')) {
      errorMessage = `❌ *ғᴀɪʟᴇᴅ ᴛᴏ sʜᴏʀᴛᴇɴ ᴜʀʟ:* ${error.message}\n` +
                     `💡 *ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ, sᴡᴇᴇᴛɪᴇ.*`;
    }
    await socket.sendMessage(sender, { text: errorMessage }, { quoted: msg });
  }
  break;
}

// case 39: weather
                case 'weather': {
  try {
    await socket.sendMessage(sender, { react: { text: '🌦️', key: msg.key } });

    if (!q || q.trim() === '') {
      await socket.sendMessage(sender, {
        text: `📌 *ᴜsᴀɢᴇ:* ${config.PREFIX}weather <ᴄɪᴛʏ>\n` +
              `*ᴇxᴀᴍᴘʟᴇ:* ${config.PREFIX}ᴡᴇᴀᴛʜᴇʀ ʜᴀɪᴛɪ`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⏳ *ғᴇᴛᴄʜɪɴɢ ᴡᴇᴀᴛʜᴇʀ ᴅᴀᴛᴀ...*`
    }, { quoted: msg });

    const apiKey = '2d61a72574c11c4f36173b627f8cb177';
    const city = q.trim();
    const url = `http://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;

    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;

    const weatherMessage = `
🌍 *ᴡᴇᴀᴛʜᴇʀ ɪɴғᴏ ғᴏʀ* ${data.name}, ${data.sys.country}
🌡️ *ᴛᴇᴍᴘᴇʀᴀᴛᴜʀᴇ:* ${data.main.temp}°C
🌡️ *ғᴇᴇʟs ʟɪᴋᴇ:* ${data.main.feels_like}°C
🌡️ *ᴍɪɴ ᴛᴇᴍᴘ:* ${data.main.temp_min}°C
🌡️ *ᴍᴀx ᴛᴇᴍᴘ:* ${data.main.temp_max}°C
💧 *ʜᴜᴍɪᴅɪᴛʏ:* ${data.main.humidity}%
☁️ *ᴡᴇᴀᴛʜᴇʀ:* ${data.weather[0].main}
🌫️ *ᴅᴇsᴄʀɪᴘᴛɪᴏɴ:* ${data.weather[0].description}
💨 *ᴡɪɴᴅ sᴘᴇᴇᴅ:* ${data.wind.speed} m/s
🔽 *ᴘʀᴇssᴜʀᴇ:* ${data.main.pressure} hPa
    `;

    await socket.sendMessage(sender, {
      text: `🌤 *ᴡᴇᴀᴛʜᴇʀ ʀᴇᴘᴏʀᴛ* 🌤\n\n${weatherMessage}\n\n> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`
    }, { quoted: msg });

  } catch (error) {
    console.error('Weather command error:', error.message);
    let errorMessage = `❌ *ᴏʜ, ʟᴏᴠᴇ, ᴄᴏᴜʟᴅɴ'ᴛ ғᴇᴛᴄʜ ᴛʜᴇ ᴡᴇᴀᴛʜᴇʀ! 😢*\n` +
                      `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`;
    if (error.message.includes('404')) {
      errorMessage = `🚫 *ᴄɪᴛʏ ɴᴏᴛ ғᴏᴜɴᴅ, sᴡᴇᴇᴛɪᴇ.*\n` +
                     `💡 *ᴘʟᴇᴀsᴇ ᴄʜᴇᴄᴋ ᴛʜᴇ sᴘᴇʟʟɪɴɢ ᴀɴᴅ ᴛʀʏ ᴀɢᴀɪɴ.*`;
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      errorMessage = `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ғᴇᴛᴄʜ ᴡᴇᴀᴛʜᴇʀ:* ${error.message}\n` +
                     `💡 *ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ, ʙᴀʙᴇ.*`;
    }
    await socket.sendMessage(sender, { text: errorMessage }, { quoted: msg });
  }
  break;
}

case 'savestatus': {
  try {
    await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } });

    if (!msg.quoted || !msg.quoted.statusMessage) {
      await socket.sendMessage(sender, {
        text: `📌 *ʀᴇᴘʟʏ ᴛᴏ ᴀ sᴛᴀᴛᴜs ᴛᴏ sᴀᴠᴇ ɪᴛ, ᴅᴀʀʟɪɴɢ!* 😘`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⏳ *sᴀᴠɪɴɢ sᴛᴀᴛᴜs, sᴡᴇᴇᴛɪᴇ...* 😘`
    }, { quoted: msg });

    const media = await socket.downloadMediaMessage(msg.quoted);
    const fileExt = msg.quoted.imageMessage ? 'jpg' : 'mp4';
    const filePath = `./status_${Date.now()}.${fileExt}`;
    fs.writeFileSync(filePath, media);

    await socket.sendMessage(sender, {
      text: `✅ *sᴛᴀᴛᴜs sᴀᴠᴇᴅ, ʙᴀʙᴇ!* 😘\n` +
            `📁 *ғɪʟᴇ:* status_${Date.now()}.${fileExt}\n` +
            `> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`,
      document: { url: filePath },
      mimetype: msg.quoted.imageMessage ? 'image/jpeg' : 'video/mp4',
      fileName: `status_${Date.now()}.${fileExt}`
    }, { quoted: msg });

  } catch (error) {
    console.error('Savestatus command error:', error.message);
    await socket.sendMessage(sender, {
      text: `❌ *ᴏʜ, ʟᴏᴠᴇ, ᴄᴏᴜʟᴅɴ'ᴛ sᴀᴠᴇ ᴛʜᴀᴛ sᴛᴀᴛᴜs! 😢*\n` +
            `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`
    }, { quoted: msg });
  }
  break;
}

case 'mediafire':
case 'mf':
case 'mfdl': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const url = text.split(" ")[1]; // .mediafire <link>

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'ASHIYA MINI BOT AI';

        // ✅ Fake Meta contact message (like Facebook style)
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please send a MediaFire link.*\n\nExample: .mediafire <url>'
            }, { quoted: shonux });
        }

        // ⏳ Notify start
        await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Fetching MediaFire file info...*' }, { quoted: shonux });

        // 🔹 Call API
        let api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
        let { data } = await axios.get(api);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '❌ *Failed to fetch MediaFire file.*' }, { quoted: shonux });
        }

        const result = data.result;
        const title = result.title || result.filename;
        const filename = result.filename;
        const fileSize = result.size;
        const downloadUrl = result.url;

        const caption = `📦 *${title}*\n\n` +
                        `📁 *Filename:* ${filename}\n` +
                        `📏 *Size:* ${fileSize}\n` +
                        `🌐 *From:* ${result.from}\n` +
                        `📅 *Date:* ${result.date}\n` +
                        `🕑 *Time:* ${result.time}\n\n` +
                        `✅ Downloaded by ${botName}`;

        // 🔹 Send file automatically (document type for .zip etc.)
        await socket.sendMessage(sender, {
            document: { url: downloadUrl },
            fileName: filename,
            mimetype: 'application/octet-stream',
            caption: caption
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in MediaFire downloader:", err);

        // ✅ In catch also send Meta mention style
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'ASHIYA MINI BOT AI';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}

case 'sticker':
case 's': {
    await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });

    try {
        let quoted = msg.quoted ? msg.quoted : msg;
        let mime = (quoted.msg || quoted).mimetype || '';

        if (!mime) {
            return socket.sendMessage(from, { text: '⚠️ ʀᴇᴘʟʏ ᴡɪᴛʜ ᴀɴ ɪᴍᴀɢᴇ/ᴠɪᴅᴇᴏ ᴛᴏ ᴍᴀᴋᴇ ᴀ sᴛɪᴄᴋᴇʀ!' }, { quoted: msg });
        }

        if (/image|video/.test(mime)) {
            let media = await quoted.download();
            await socket.sendMessage(from, { 
                sticker: media 
            }, { quoted: msg });
        } else {
            await socket.sendMessage(from, { text: '❌ ᴏɴʟʏ ɪᴍᴀɢᴇ ᴏʀ ᴠɪᴅᴇᴏ ᴀʟʟᴏᴡᴇᴅ ᴛᴏ ᴄʀᴇᴀᴛᴇ sᴛɪᴄᴋᴇʀ!' }, { quoted: msg });
        }
    } catch (error) {
        console.error('Error in .sticker command:', error);
        await socket.sendMessage(from, { text: '💔 ғᴀɪʟᴇᴅ ᴛᴏ ᴄʀᴇᴀᴛᴇ sᴛɪᴄᴋᴇʀ. ᴛʀʏ ᴀɢᴀɪɴ!' }, { quoted: msg });
    }
    break;
}

case 'url': {
  try {
    await socket.sendMessage(sender, { react: { text: '📤', key: msg.key || {} } });

    console.log('Message:', JSON.stringify(msg, null, 2));
    const quoted = msg.quoted || msg;
    console.log('Quoted:', JSON.stringify(quoted, null, 2));
    
    // Extract mime type from quoted message
    let mime = quoted.mimetype || '';
    if (!mime && quoted.message) {
      const messageType = Object.keys(quoted.message)[0];
      const mimeMap = {
        imageMessage: 'image/jpeg',
        videoMessage: 'video/mp4',
        audioMessage: 'audio/mpeg',
        documentMessage: 'application/octet-stream'
      };
      mime = mimeMap[messageType] || '';
    }

    console.log('MIME Type:', mime);

    if (!mime || !['image', 'video', 'audio', 'application'].some(type => mime.includes(type))) {
      await socket.sendMessage(sender, {
        text: `❌ *ʀᴇᴘʟʏ ᴛᴏ ɪᴍᴀɢᴇ, ᴀᴜᴅɪᴏ, ᴏʀ ᴠɪᴅᴇᴏ!*\n` +
              `Detected type: ${mime || 'none'}`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⏳ *ᴜᴘʟᴏᴀᴅɪɴɢ ғɪʟᴇ...*`
    }, { quoted: msg });

    const buffer = await socket.downloadMediaMessage(quoted);
    if (!buffer || buffer.length === 0) {
      throw new Error('Failed to download media: Empty buffer');
    }

    // Determine file extension
    const ext = mime.includes('image/jpeg') ? '.jpg' :
                mime.includes('image/png') ? '.png' :
                mime.includes('image/gif') ? '.gif' :
                mime.includes('video') ? '.mp4' :
                mime.includes('audio') ? '.mp3' : '.bin';
    
    const name = `file_${Date.now()}${ext}`;
    const tmp = path.join(os.tmpdir(), name);
    
    // Ensure the tmp directory exists
    if (!fs.existsSync(os.tmpdir())) {
      fs.mkdirSync(os.tmpdir(), { recursive: true });
    }
    
    fs.writeFileSync(tmp, buffer);
    console.log('Saved file to:', tmp);

    const form = new FormData();
    form.append('fileToUpload', fs.createReadStream(tmp), name);
    form.append('reqtype', 'fileupload');

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders(),
      timeout: 30000 // 30 second timeout
    });

    // Clean up temporary file
      
          if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }

    if (!res.data || res.data.includes('error')) {
      throw new Error(`Upload failed: ${res.data || 'No response data'}`);
    }

    const type = mime.includes('image') ? 'ɪᴍᴀɢᴇ' :
                 mime.includes('video') ? 'ᴠɪᴅᴇᴏ' :
                 mime.includes('audio') ? 'ᴀᴜᴅɪᴏ' : 'ғɪʟᴇ';

    await socket.sendMessage(sender, {
      text: `✅ *${type} ᴜᴘʟᴏᴀᴅᴇᴅ!*\n\n` +
            `📁 *sɪᴢᴇ:* ${formatBytes(buffer.length)}\n` +
            `🔗 *ᴜʀʟ:* ${res.data}\n\n` +
            `> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`
    }, { quoted: msg });

    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key || {} } });
  } catch (error) {
    console.error('tourl2 error:', error.message, error.stack);
    
    // Clean up temporary file if it exists
    if (tmp && fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (e) {
        console.error('Error cleaning up temp file:', e.message);
      }
    }
    
    await socket.sendMessage(sender, {
      text: `❌ *ᴄᴏᴜʟᴅɴ'ᴛ ᴜᴘʟᴏᴀᴅ ᴛʜᴀᴛ ғɪʟᴇ! 😢*\n` +
            `ᴇʀʀᴏʀ: ${error.message || 'sᴏᴍᴇᴛʜɪɴɢ ᴡᴇɴᴛ ᴡʀᴏɴɢ'}\n` +
            `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`
    }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key || {} } });
  }
  break;
}
case 'tourl2': {
  try {
    await socket.sendMessage(sender, { react: { text: '📤', key: msg.key || {} } });

    console.log('Message:', JSON.stringify(msg, null, 2));
    const quoted = msg.quoted || msg;
    console.log('Quoted:', JSON.stringify(quoted, null, 2));
    const mime = quoted.mimetype || (quoted.message ? Object.keys(quoted.message)[0] : '');

    console.log('MIME Type or Message Type:', mime);

    // Map message types to MIME types if mimetype is unavailable
    const mimeMap = {
      imageMessage: 'image/jpeg',
      videoMessage: 'video/mp4',
      audioMessage: 'audio/mp3'
    };
    const effectiveMime = mimeMap[mime] || mime;

    if (!effectiveMime || !['image', 'video', 'audio'].some(type => effectiveMime.includes(type))) {
      await socket.sendMessage(sender, {
        text: `❌ *ʀᴇᴘʟʏ ᴛᴏ ɪᴍᴀɢᴇ, ᴀᴜᴅɪᴏ, ᴏʀ ᴠɪᴅᴇᴏ!*\n` +
              `ᴅᴇᴛᴇᴄᴛᴇᴅ ᴛʏᴘᴇ: ${effectiveMime || 'none'}`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, {
      text: `⏳ *ᴜᴘʟᴏᴀᴅɪɴɢ ғɪʟᴇ...*`
    }, { quoted: msg });

    const buffer = await socket.downloadMediaMessage(quoted);
    if (!buffer || buffer.length === 0) {
      throw new Error('Failed to download media: Empty buffer');
    }

    const ext = effectiveMime.includes('image/jpeg') ? '.jpg' :
                effectiveMime.includes('image/png') ? '.png' :
                effectiveMime.includes('video') ? '.mp4' :
                effectiveMime.includes('audio') ? '.mp3' : '.bin';
    const name = `file_${Date.now()}${ext}`;
    const tmp = path.join(os.tmpdir(), `catbox_${Date.now()}${ext}`);
    fs.writeFileSync(tmp, buffer);
    console.log('Saved file to:', tmp);

    const form = new FormData();
    form.append('fileToUpload', fs.createReadStream(tmp), name);
    form.append('reqtype', 'fileupload');

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders()
    });

    fs.unlinkSync(tmp);

    if (!res.data || res.data.includes('error')) {
      throw new Error(`Upload failed: ${res.data || 'No response data'}`);
    }

    const type = effectiveMime.includes('image') ? 'ɪᴍᴀɢᴇ' :
                 effectiveMime.includes('video') ? 'ᴠɪᴅᴇᴏ' :
                 effectiveMime.includes('audio') ? 'ᴀᴜᴅɪᴏ' : 'ғɪʟᴇ';

    await socket.sendMessage(sender, {
      text: `✅ *${type} ᴜᴘʟᴏᴀᴅᴇᴅ!*\n\n` +
            `📁 *sɪᴢᴇ:* ${formatBytes(buffer.length)}\n` +
            `🔗 *ᴜʀʟ:* ${res.data}\n\n` +
            `© ᴍᴀᴅᴇ ɪɴ ʙʏ ꜱʜᴇʀᴀɴ💐💗`
    }, { quoted: msg });

    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key || {} } });
  } catch (error) {
    console.error('tourl2 error:', error.message, error.stack);
    await socket.sendMessage(sender, {
      text: `❌ *ᴏʜ, ʟᴏᴠᴇ, ᴄᴏᴜʟᴅɴ'ᴛ ᴜᴘʟᴏᴀᴅ ᴛʜᴀᴛ ғɪʟᴇ! 😢*\n` +
            `ᴇʀʀᴏʀ: ${error.message || 'sᴏᴍᴇᴛʜɪɴɢ ᴡᴇɴᴛ ᴡʀᴏɴɢ'}\n` +
            `💡 *ᴛʀʏ ᴀɢᴀɪɴ, ᴅᴀʀʟɪɴɢ?*`
    }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key || {} } });
  }
  break;
}
    
    case 'whois': {
        try {
            await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
            const domain = args[0];
            if (!domain) {
                await socket.sendMessage(sender, { text: '📌 ᴜsᴀɢᴇ: .whois <domain>' }, { quoted: fakevCard });
                break;
            }
            const response = await fetch(`http://api.whois.vu/?whois=${encodeURIComponent(domain)}`);
            const data = await response.json();
            if (!data.domain) {
                throw new Error('Domain not found');
            }
            const whoisMessage = formatMessage(
                '🔍 𝐖𝐇𝐎𝐈𝐒 𝐋𝐎𝐎𝐊𝐔𝐏',
                `🌐 ᴅᴏᴍᴀɪɴ: ${data.domain}\n` +
                `📅 ʀᴇɢɪsᴛᴇʀᴇᴅ: ${data.created_date || 'N/A'}\n` +
                `⏰ ᴇxᴘɪʀᴇs: ${data.expiry_date || 'N/A'}\n` +
                `📋 ʀᴇɢɪsᴛʀᴀʀ: ${data.registrar || 'N/A'}\n` +
                `📍 sᴛᴀᴛᴜs: ${data.status.join(', ') || 'N/A'}`,
                'ᴍᴀᴅᴇ ɪɴ ʙʏ ꜱʜᴇʀᴀɴ'
            );
            await socket.sendMessage(sender, { text: whoisMessage }, { quoted: fakevCard });
        } catch (error) {
            console.error('Whois command error:', error);
            await socket.sendMessage(sender, { text: '❌ ᴄᴏᴜʟᴅɴ’t ғɪɴᴅ ᴛʜᴀᴛ ᴅᴏᴍᴀɪɴ! 😢 ᴛʀʏ ᴀɢᴀɪɴ?' }, { quoted: fakevCard });
        }
        break;
    }
      
      case 'repo':
case 'sc':
case 'script': {
    try {
        await socket.sendMessage(sender, { react: { text: '🪄', key: msg.key } });
        const githubRepoURL = 'https://github.com/Sheran351/Sheran351';
        
        const [, username, repo] = githubRepoURL.match(/github\.com\/([^/]+)\/([^/]+)/);
        const response = await fetch(`https://api.github.com/repos/${username}/${repo}`);
        
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        
        const repoData = await response.json();

        const formattedInfo = `
    ꜱʜᴇʀᴀ-ᴍᴅ
╭───────────────⭓
│✰│ɴᴀᴍᴇ: ${repoData.name}
│✰│sᴛᴀʀs: ${repoData.stargazers_count}
│✰│ꜰᴏʀᴋs: ${repoData.forks_count}
│✰│ᴏᴡɴᴇʀ: ꜱʜᴇʀᴀ-ᴍᴅ
│✰│ᴅᴇsᴄ: ${repoData.description || 'ɴ/ᴀ'}
╰───────────────⭓
> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
`;

        const repoMessage = {
            image: { url: 'https://files.catbox.moe/bhga2o.jpg' },
            caption: formattedInfo,
            buttons: [
                {
                    buttonId: `${config.PREFIX}repo-visit`,
                    buttonText: { displayText: '🌐 ᴠɪsɪᴛ ʀᴇᴘᴏ' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}repo-owner`,
                    buttonText: { displayText: '👑 ᴏᴡɴᴇʀ ᴘʀᴏғɪʟᴇ' },
                    type: 1
                }
            ],
            contextInfo: {
                mentionedJid: [m.sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: config.NEWSLETTER_JID || '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚒𝚢𝚊',
                    newsletterName: 'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍',
                    serverMessageId: 143
                }
            }
        };

        await socket.sendMessage(sender, repoMessage, { quoted: fakevCard });

    } catch (error) {
        console.error("❌ Error in repo command:", error);
        await socket.sendMessage(sender, { 
            text: "⚠️ Failed to fetch repo info. Please try again later." 
        }, { quoted: fakevCard });
    }
    break;
}

case 'repo-visit': {
    await socket.sendMessage(sender, { react: { text: '🌐', key: msg.key } });
    await socket.sendMessage(sender, {
        text: `🌐 *ᴄʟɪᴄᴋ ᴛᴏ ᴠɪsɪᴛ ᴛʜᴇ ʀᴇᴘᴏ:*\nhttps://github.com/Sheran351/Sheran351.git`,
        contextInfo: {
            externalAdReply: {
                title: 'Visit Repository',
                body: 'Open in browser',
                mediaType: 1,
                mediaUrl: 'https://github.com/Sheran351/Sheran351.git',
                sourceUrl: 'https://github.com/Sheran351/Sheran351.git'
            }
        }
    }, { quoted: fakevCard });
    break;
}

case 'repo-owner': {
    await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
    await socket.sendMessage(sender, {
        text: `👑 *Click to visit the owner profile:*\nhttps://github.com/Sheran351/Sheran351.git`,
        contextInfo: {
            externalAdReply: {
                title: 'Owner Profile',
                body: 'Open in browser',
                mediaType: 1,
                mediaUrl: 'https://github.com/Sheran351/Sheran351',
                sourceUrl: 'https://github.com/Sheran351/Sheran35'
            }
        }
    }, { quoted: fakevCard });
    break;
}

                case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
                        )
                    });
                    break;
                    
// more future commands      
                                 
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        // Update numbers.json on GitHub
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user      
                              try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            'ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

const groupStatus = groupResult.status === 'success'
    ? 'ᴊᴏɪɴᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ'
    : `ғᴀɪʟᴇᴅ ᴛᴏ ᴊᴏɪɴ ɢʀᴏᴜᴘ: ${groupResult.error}`;

// Fixed template literal and formatting
await socket.sendMessage(userJid, {
    image: { url: config.RCD_IMAGE_PATH },
    caption: `𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍
╭─────────────────────⭓
│✰│sᴜᴄᴄᴇssғᴜʟʟʏ ᴄᴏɴɴᴇᴄᴛᴇᴅ!
│✰│ɴᴜᴍʙᴇʀ: ${sanitizedNumber}
│✰│ɢʀᴏᴜᴘ sᴛᴀᴛᴜs: ${groupStatus}
│✰│ᴄᴏɴɴᴇᴄᴛᴇᴅ: ${new Date().toLocaleString()}
│✰│ᴛʏᴘᴇ *${config.PREFIX}menu* ᴛᴏ ɢᴇᴛ sᴛᴀʀᴛᴇᴅ!
╰───────────────⭓

*ᴡᴇʟᴄᴏᴍᴇ ɪɴ  ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍*

> ⃟𝐏𝐎𝐖乇𝐑𝐄⃫𝐃 𝐁𝐘 ㅹ𝐒𝐇𝐄𝐑𝐀⃢-𝐌𝐃 𝐕4⃞ 🌐⛓️🤍`
});

await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

// Improved file handling with error checking
              let numbers = [];
try {
    if (fs.existsSync(NUMBER_LIST_PATH)) {
        const fileContent = fs.readFileSync(NUMBER_LIST_PATH, 'utf8');
        numbers = JSON.parse(fileContent) || [];
    }
    
    if (!numbers.includes(sanitizedNumber)) {
        numbers.push(sanitizedNumber);
        
        // Create backup before writing
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            fs.copyFileSync(NUMBER_LIST_PATH, NUMBER_LIST_PATH + '.backup');
        }
        
        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        console.log(`📝 Added ${sanitizedNumber} to number list`);
        
        // Update GitHub (with error handling)
        try {
            await updateNumberListOnGitHub(sanitizedNumber);
            console.log(`☁️ GitHub updated for ${sanitizedNumber}`);
        } catch (githubError) {
            console.warn(`⚠️ GitHub update failed:`, githubError.message);
        }
    }
} catch (fileError) {
    console.error(`❌ File operation failed:`, fileError.message);
    // Continue execution even if file operations fail
}
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'ꜱʜᴇʀᴀ-ᴍᴅ 𝚖𝚊𝚒𝚗'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: 'ꜱʜᴇʀᴀ-ᴍᴅ',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    'ꜱʜᴇʀᴀ-ᴍᴅ'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'ᴍɪɴɪ-ꜱʜᴇʀᴀ-ᴍᴅ-ᴍᴀɪɴ'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/me-tech-maker/database/refs/heads/main/newsletter.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}


          

      
