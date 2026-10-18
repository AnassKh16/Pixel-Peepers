import {isObject, validationError} from './validation.js';

// Match the original text so replacing a token never destroys surrounding punctuation.
// Separators are allowed INSIDE words, including invisible separators used to evade filters.
const separator = '[_.*\\-\\p{Cf}\\u034f]*';
const substitutions = {a: '[a@]', o: '[o0]', i: '[i1!]', e: '[e3]', s: '[s$]'};
const words = ['badword', 'porn', 'scam', 'fuck', 'shit', 'bitch', 'asshole', 'idiotspam'];
const alternatives = words.map(word => [...word].map(char => substitutions[char] ?? char).join(separator));
// Section 3.3 explicitly names s!c@m although ! -> i yields 'sicam'.
// Recognize that exact obfuscation as an alias without censoring the word 'sicam'.
alternatives.push('s' + separator + '!' + separator + 'c' + separator + '[a@]' + separator + 'm');
const profanity = new RegExp('(?<![\\p{L}\\p{N}])(?:' + alternatives.join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
const flood = /([\s\S])\1{3}|!{3}|\?{3}/iu;

export function validateMessages(messages) {
  if (!Array.isArray(messages)) validationError(['incoming_messages']);
  const fields = [];
  messages.forEach((message, index) => {
    if (!isObject(message)) { fields.push(`incoming_messages.${index}`); return; }
    for (const key of ['message_id', 'sender', 'text']) {
      if (typeof message[key] !== 'string' || (key !== 'text' && !message[key].trim()))
        fields.push(`incoming_messages.${index}.${key}`);
    }
  });
  if (fields.length) validationError(fields);
  return messages;
}

/** Pure, request-local Section 5.8 moderation. Flood takes precedence over profanity. */
export function moderate(messages) {
  validateMessages(messages);
  const filtered_messages = [], kicked = new Set(), muted = new Set();
  for (const message of messages) {
    if (flood.test(message.text)) { muted.add(message.sender); continue; }
    let flagged = false;
    const text = message.text.replace(profanity, () => { flagged = true; return '***'; });
    if (flagged) kicked.add(message.sender);
    filtered_messages.push({...message, text, flagged, reason: flagged ? 'profanity_leetspeak' : null});
  }
  return {filtered_messages, kicked_users: [...kicked], muted_users: [...muted]};
}
