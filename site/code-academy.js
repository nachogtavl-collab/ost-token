/* ==========================================================================
 * OST · Code Academy v2 — teach-as-you-type
 * --------------------------------------------------------------------------
 * Replaces the old typing-test / single-quiz Code Academy modal with a real
 * mini-curriculum: each lesson is a list of CODE LINES with an EXPLANATION
 * for every line ("what you just typed and why"). The user types each line
 * exactly; once correct, the next line unlocks and the explanation expands.
 *
 * - Reuses the same credit balance as faucet-hub.js  (`ost.faucet.hub.v2`)
 * - Adds: lesson picker, live "what does this do" panel, run-output preview
 *   for safe JS lessons, level progression saved per user.
 * - Hooks the existing #fhTaskBtn button (Open Code Academy) by overriding
 *   its click handler, so faucet-hub doesn't need to be edited.
 * ========================================================================== */
(function () {
  'use strict';

  var STATE_KEY = 'ost.faucet.hub.v2';
  var ACADEMY_KEY = 'ost.academy.v2';

  function loadBank() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (_) { return {}; } }
  function saveBank(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {} }
  function loadAcademy() { try { return JSON.parse(localStorage.getItem(ACADEMY_KEY) || '{}'); } catch (_) { return {}; } }
  function saveAcademy(s) { try { localStorage.setItem(ACADEMY_KEY, JSON.stringify(s)); } catch (_) {} }

  function award(amount, source) {
    var s = loadBank();
    s.credits = Number(s.credits || 0) + Number(amount || 0);
    s.lifetime = Number(s.lifetime || 0) + Number(amount || 0);
    saveBank(s);
    var fh = document.getElementById('fhCredits');
    if (fh) fh.textContent = Number(s.credits || 0).toFixed(2);
    document.querySelectorAll('[data-ostg-balance]').forEach(function (e) {
      e.textContent = Number(s.credits || 0).toFixed(2);
    });
    try { window.dispatchEvent(new CustomEvent('ost-faucet-hub-award', { detail: { credits: amount, source: source || 'academy', total: s.credits }})); } catch (_) {}
  }

  // ────────────────────────────────────────────────────────────────────────
  // Curriculum — every line has an explanation
  // ────────────────────────────────────────────────────────────────────────
  var LESSONS = [
    {
      id: 'zero-hello',
      level: 'start',
      title: 'Start 1 · Make the computer say hello',
      reward: 1,
      intro: 'Code is a set of tiny instructions. This first instruction asks the computer to show a message.',
      lines: [
        { code: 'console.log("Hello, coder!");',
          why: '`console.log` means "show this message". The words inside quotes are the message. The semicolon is like a period at the end of a sentence.' }
      ],
      run: function () { return ['Hello, coder!']; }
    },
    {
      id: 'zero-name',
      level: 'start',
      title: 'Start 2 · Save a word in a box',
      reward: 1,
      intro: 'A variable is a little named box. Put a word in the box, then use the box later.',
      lines: [
        { code: 'let name = "Mia";',
          why: '`let` makes a box called `name`. The box is holding the word "Mia".' },
        { code: 'console.log(name);',
          why: 'Now we ask the computer to show what is inside the `name` box. It prints Mia.' }
      ],
      run: function () { return ['Mia']; }
    },
    {
      id: 'zero-math',
      level: 'start',
      title: 'Start 3 · Add numbers',
      reward: 2,
      intro: 'Computers are very good at math. We can save numbers, add them, and print the answer.',
      lines: [
        { code: 'let apples = 2;',
          why: 'This makes a number box called `apples` and puts 2 inside.' },
        { code: 'let oranges = 3;',
          why: 'This makes another number box called `oranges` and puts 3 inside.' },
        { code: 'console.log(apples + oranges);',
          why: '`+` adds the two numbers. The computer prints 5.' }
      ],
      run: function () { return ['5']; }
    },
    {
      id: 'zero-if',
      level: 'start',
      title: 'Start 4 · Make a choice with if',
      reward: 2,
      intro: 'An `if` statement lets code make a choice, like: if it is raining, take an umbrella.',
      lines: [
        { code: 'let score = 10;',
          why: 'We save the number 10 in a box named `score`.' },
        { code: 'if (score > 5) {',
          why: '`if` checks a question. Here the question is: is score bigger than 5?' },
        { code: '  console.log("You win!");',
          why: 'This line runs only when the question is true. The two spaces are indentation, which helps humans read the code.' },
        { code: '}',
          why: 'The closing brace ends the `if` block.' }
      ],
      run: function () { return ['You win!']; }
    },
    {
      id: 'zero-loop',
      level: 'start',
      title: 'Start 5 · Repeat with a loop',
      reward: 3,
      intro: 'A loop repeats code so you do not have to type the same instruction over and over.',
      lines: [
        { code: 'for (let count = 1; count <= 3; count++) {',
          why: '`for` starts a loop. It begins at 1, keeps going while the count is 3 or less, and adds 1 each time.' },
        { code: '  console.log(count);',
          why: 'Each loop round prints the current count.' },
        { code: '}',
          why: 'The closing brace ends the loop. The output is 1, then 2, then 3.' }
      ],
      run: function () { return ['1', '2', '3']; }
    },
    {
      id: 'zero-html',
      level: 'start',
      title: 'Start 6 · Build your first web page',
      reward: 3,
      intro: 'HTML is the skeleton of a web page. Tags tell the browser what each piece means.',
      lines: [
        { code: '<h1>My first page</h1>',
          why: '`<h1>` means the biggest heading on the page. `</h1>` closes the heading.' },
        { code: '<p>I am learning to code.</p>',
          why: '`<p>` means paragraph. The words between the tags are what people see on the page.' }
      ]
    },
    {
      id: 'zero-css',
      level: 'start',
      title: 'Start 7 · Make text look friendly',
      reward: 3,
      intro: 'CSS is the clothing of a web page. It controls color, size, spacing, and layout.',
      lines: [
        { code: '.title {',
          why: '`.title` finds anything with `class="title"`. The `{` starts the style rules.' },
        { code: '  color: blue;',
          why: '`color` changes text color. This makes the text blue.' },
        { code: '  font-size: 32px;',
          why: '`font-size` changes how tall the letters are. `px` means pixels.' },
        { code: '}',
          why: 'The closing brace ends the style rules.' }
      ]
    },
    {
      id: 'zero-button',
      level: 'start',
      title: 'Start 8 · Make a button react',
      reward: 4,
      intro: 'Web apps feel alive when buttons listen for clicks and run code.',
      lines: [
        { code: 'const button = document.querySelector("button");',
          why: '`document.querySelector("button")` finds the first button on the page. We save it in a box called `button`.' },
        { code: 'button.addEventListener("click", () => {',
          why: '`addEventListener` means "listen for something". Here it listens for a click.' },
        { code: '  console.log("Button clicked!");',
          why: 'This message prints when the button is clicked.' },
        { code: '});',
          why: 'This closes the click listener.' }
      ]
    },
    {
      id: 'js-hello',
      level: 'beginner',
      title: 'JavaScript · Your first variable',
      reward: 4,
      intro: 'A variable is a named box that holds a value. We will declare one, then print it.',
      lines: [
        { code: 'let name = "Ada";',
          why: '`let` declares a variable that can change later. We name it `name` and assign the string "Ada". Strings live inside quotes.' },
        { code: 'console.log(name);',
          why: '`console.log` prints to the developer console. Passing the variable `name` makes the browser print its current value: Ada.' },
        { code: 'name = "Grace";',
          why: 'No `let` this time — we are RE-assigning the existing variable. Because we used `let`, this is allowed. With `const`, this line would throw an error.' },
        { code: 'console.log(name);',
          why: 'Now the variable holds "Grace", so the second print shows the new value. Order of execution matters.' }
      ],
      run: function () { return ['Ada', 'Grace']; }
    },
    {
      id: 'js-function',
      level: 'beginner',
      title: 'JavaScript · A function that adds two numbers',
      reward: 6,
      intro: 'Functions are reusable blocks. We will write one that takes two inputs and returns their sum.',
      lines: [
        { code: 'function add(a, b) {',
          why: '`function` keyword names this block `add`. The names inside `(…)` are PARAMETERS — placeholders for whatever values the caller will pass.' },
        { code: '  return a + b;',
          why: 'Inside the function body, `+` adds the two parameters. `return` sends that value back to whoever called the function and stops the function.' },
        { code: '}',
          why: 'The closing brace `}` ends the function body. JavaScript uses braces to group statements — every `{` needs a matching `}`.' },
        { code: 'console.log(add(2, 3));',
          why: 'We CALL `add` with the arguments 2 and 3. The function returns 5, then `console.log` prints it.' }
      ],
      run: function () { return ['5']; }
    },
    {
      id: 'js-array-map',
      level: 'intermediate',
      title: 'JavaScript · Transform an array with .map()',
      reward: 10,
      intro: '`.map()` is the bread-and-butter of modern JS — it returns a NEW array where each item has been transformed by your function.',
      lines: [
        { code: 'const nums = [1, 2, 3, 4];',
          why: '`const` declares a variable that cannot be re-assigned. `[…]` creates an array literal containing four numbers.' },
        { code: 'const doubled = nums.map(n => n * 2);',
          why: '`.map(callback)` runs the callback once per item. `n => n * 2` is an ARROW function — short for `function(n){ return n*2; }`. The result is a brand new array.' },
        { code: 'console.log(doubled);',
          why: 'We print the new array. Importantly, the original `nums` is untouched — `.map` does not mutate. That immutability prevents many bugs.' }
      ],
      run: function () { return ['[2, 4, 6, 8]']; }
    },
    {
      id: 'js-async',
      level: 'intermediate',
      title: 'JavaScript · async / await for network calls',
      reward: 14,
      intro: 'Network calls are asynchronous — they take time. `async`/`await` lets you write them as if they were synchronous.',
      lines: [
        { code: 'async function getUser() {',
          why: 'The `async` keyword marks this function as asynchronous. It will automatically return a Promise.' },
        { code: '  const res = await fetch("/api/user");',
          why: '`fetch` returns a Promise. `await` pauses this function until the Promise resolves, then assigns the response object to `res`. The rest of your app keeps running.' },
        { code: '  const data = await res.json();',
          why: '`res.json()` is itself a Promise that resolves to the parsed JSON body. We `await` it again to get the actual object.' },
        { code: '  return data;',
          why: 'We return the parsed data. Because the function is `async`, callers will receive a Promise that resolves to this value.' },
        { code: '}',
          why: 'Closing brace ends the function. To use it: `getUser().then(d => console.log(d));` or `await getUser()` inside another async function.' }
      ]
    },
    {
      id: 'html-button',
      level: 'beginner',
      title: 'HTML · A clickable button',
      reward: 4,
      intro: 'HTML elements describe structure. The `<button>` tag is a built-in clickable element.',
      lines: [
        { code: '<!DOCTYPE html>',
          why: 'Tells the browser to render in standards mode. Always the first line of an HTML document.' },
        { code: '<html lang="en">',
          why: 'The root element. The `lang` attribute helps screen readers and search engines understand the language.' },
        { code: '<body>',
          why: 'Everything visible on the page goes inside `<body>`. There can be only one `<body>` per document.' },
        { code: '  <button onclick="alert(\'Hi!\')">Click me</button>',
          why: 'A `<button>` element. The `onclick` attribute runs JavaScript when clicked. `alert(…)` pops a tiny dialog. The text between the tags is what users see.' },
        { code: '</body>',
          why: 'Every opening tag needs a matching close. `</body>` ends the visible content.' },
        { code: '</html>',
          why: 'Closes the root element and ends the document.' }
      ]
    },
    {
      id: 'css-flex',
      level: 'beginner',
      title: 'CSS · Centre something with Flexbox',
      reward: 6,
      intro: 'Flexbox is the modern way to align children of a container in one dimension.',
      lines: [
        { code: '.box {',
          why: 'A CSS rule starts with a SELECTOR. `.box` matches every element with `class="box"`. The brace opens the declaration block.' },
        { code: '  display: flex;',
          why: '`display: flex` turns the element into a flex container. Its direct children become flex items, ready to be aligned.' },
        { code: '  justify-content: center;',
          why: 'Centres the children along the MAIN axis (horizontal by default).' },
        { code: '  align-items: center;',
          why: 'Centres the children along the CROSS axis (vertical by default). Together with `justify-content`, this perfectly centres any child.' },
        { code: '}',
          why: 'Closing brace ends the rule. Apply it to an element with `<div class="box">…</div>`.' }
      ]
    },
    {
      id: 'sql-select',
      level: 'intermediate',
      title: 'SQL · Filter rows with WHERE',
      reward: 8,
      intro: 'SQL is the language for talking to relational databases. SELECT pulls rows out of a table.',
      lines: [
        { code: 'SELECT name, email',
          why: '`SELECT` says which COLUMNS you want back. Listing them explicitly is faster and clearer than `SELECT *`.' },
        { code: 'FROM users',
          why: '`FROM` names the TABLE to read from. Here we read from a table called `users`.' },
        { code: 'WHERE active = 1',
          why: '`WHERE` filters rows. Only rows where the `active` column equals 1 are returned. Without `WHERE`, you would get every row.' },
        { code: 'ORDER BY name ASC',
          why: '`ORDER BY` sorts the result. `ASC` = ascending (A→Z). Use `DESC` for the reverse.' },
        { code: 'LIMIT 10;',
          why: '`LIMIT` caps the number of rows returned. The semicolon `;` ends the statement.' }
      ]
    },
    {
      id: 'rust-fn',
      level: 'advanced',
      title: 'Rust · A function with explicit types',
      reward: 18,
      intro: 'Rust is a systems language. Every variable has a type known at compile time.',
      lines: [
        { code: 'fn add(a: i32, b: i32) -> i32 {',
          why: '`fn` declares a function. `a: i32` means parameter `a` is a 32-bit signed integer. `-> i32` is the RETURN type. Rust is strict — types must line up.' },
        { code: '    a + b',
          why: 'No `return` keyword and no semicolon — in Rust, an expression at the end of a block IS the return value. `a + b` evaluates to a number and is returned.' },
        { code: '}',
          why: 'Closes the function. If you added `;` after `a + b`, the expression would become a STATEMENT and the function would return `()` (unit) — a compile error.' },
        { code: 'fn main() {',
          why: '`main` is the program entry point. The OS calls it when your binary starts.' },
        { code: '    println!("{}", add(2, 3));',
          why: '`println!` is a MACRO (note the `!`). `{}` is a placeholder, replaced by the next argument. So this prints 5.' },
        { code: '}',
          why: 'Closes `main`. The program ends here.' }
      ]
    },
    {
      id: 'solana-anchor',
      level: 'advanced',
      title: 'Solana · An Anchor instruction',
      reward: 25,
      intro: 'Anchor is the Rust framework that builds Solana programs. Each `#[program]` function is an INSTRUCTION callable from a wallet.',
      lines: [
        { code: '#[program]',
          why: 'An Anchor ATTRIBUTE telling the framework: "the items inside this `mod` block are the public instructions of this on-chain program."' },
        { code: 'pub mod ost_betting {',
          why: '`pub mod` declares a public module. The name `ost_betting` shows in IDLs and clients.' },
        { code: '    use super::*;',
          why: 'Brings every item from the parent scope into this module — including the `Context` types we will use below.' },
        { code: '    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64) -> Result<()> {',
          why: '`Context<PlaceBet>` is Anchor magic — it auto-validates the accounts the caller supplied against the `PlaceBet` struct. `amount: u64` is an unsigned 64-bit integer.' },
        { code: '        ctx.accounts.bet.amount = amount;',
          why: 'We write to the `amount` field of the `bet` account. Anchor handles serialization for us.' },
        { code: '        Ok(())',
          why: '`Result<()>` returns either `Ok(())` (success, no value) or `Err(error)`. Returning `Ok(())` finalises the instruction.' },
        { code: '    }',
          why: 'Closes the function.' },
        { code: '}',
          why: 'Closes the program module. After `anchor build`, this becomes a compiled BPF binary deployable to Solana.' }
      ]
    }
  ];

  // ────────────────────────────────────────────────────────────────────────
  // UI
  // ────────────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ostAcademyStyle')) return;
    var st = document.createElement('style');
    st.id = 'ostAcademyStyle';
    st.textContent =
      '.oac-modal{position:fixed;inset:0;background:rgba(2,6,16,0.88);backdrop-filter:blur(10px);z-index:10001;display:flex;align-items:center;justify-content:center;padding:14px;}' +
      '.oac-card{background:linear-gradient(180deg,#0f131e,#080b15);border:1px solid rgba(120,180,255,0.25);border-radius:18px;max-width:1100px;width:100%;max-height:94vh;overflow:hidden;display:grid;grid-template-rows:auto 1fr;}' +
      '.oac-head{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}' +
      '.oac-title{display:flex;align-items:center;gap:10px;color:#f8fafc;font-weight:700;font-size:1.1rem;}' +
      '.oac-balance{color:#f5c468;font-size:13px;font-weight:600;}' +
      '.oac-close{background:transparent;border:none;color:#94a3b8;font-size:1.6rem;cursor:pointer;}' +
      '.oac-body{display:grid;grid-template-columns:240px 1fr;height:calc(94vh - 60px);min-height:0;}' +
      '.oac-sidebar{border-right:1px solid rgba(255,255,255,0.07);overflow-y:auto;padding:10px;}' +
      '.oac-lesson-btn{display:block;width:100%;text-align:left;padding:10px 12px;border-radius:10px;background:transparent;border:1px solid transparent;color:#cbd5e1;font-size:13px;cursor:pointer;margin-bottom:4px;}' +
      '.oac-lesson-btn:hover{background:rgba(56,118,252,0.1);}' +
      '.oac-lesson-btn.is-active{background:rgba(56,118,252,0.2);border-color:rgba(120,180,255,0.35);color:#bfdbfe;}' +
      '.oac-lesson-btn.is-done::after{content:"✓";float:right;color:#86efac;}' +
      '.oac-lesson-level{display:inline-block;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,0.06);color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.04em;margin-left:4px;}' +
      '.oac-main{display:grid;grid-template-rows:auto 1fr auto;overflow:hidden;}' +
      '.oac-intro{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(56,118,252,0.05);}' +
      '.oac-intro h4{margin:0 0 4px;color:#f8fafc;font-size:1rem;}' +
      '.oac-intro p{margin:0;color:#94a3b8;font-size:13px;line-height:1.5;}' +
      '.oac-workspace{display:grid;grid-template-columns:1fr 1fr;gap:0;overflow:hidden;min-height:0;}' +
      '.oac-editor,.oac-explain{padding:14px;overflow-y:auto;min-height:0;}' +
      '.oac-editor{background:#0a0d18;border-right:1px solid rgba(255,255,255,0.07);}' +
      '.oac-line{display:grid;grid-template-columns:32px 1fr;gap:8px;align-items:start;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.04);}' +
      '.oac-line-num{color:#475569;font-family:ui-monospace,Menlo,monospace;font-size:12px;text-align:right;padding-top:6px;}' +
      '.oac-line-content{display:flex;flex-direction:column;gap:4px;}' +
      '.oac-line-target{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#64748b;white-space:pre-wrap;word-break:break-all;}' +
      '.oac-line.is-active .oac-line-target{color:#f5c468;}' +
      '.oac-line.is-done .oac-line-target{color:#86efac;}' +
      '.oac-line-input{font-family:ui-monospace,Menlo,monospace;font-size:13px;width:100%;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid rgba(120,180,255,0.25);color:#f8fafc;}' +
      '.oac-line-input:focus{outline:2px solid #38bdf8;border-color:transparent;}' +
      '.oac-line-input.is-mismatch{border-color:#ef4444;background:rgba(220,38,38,0.08);}' +
      '.oac-explain{background:rgba(15,18,30,0.6);}' +
      '.oac-explain h5{margin:0 0 8px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.06em;}' +
      '.oac-explain-current{padding:12px;border-radius:10px;background:rgba(245,196,104,0.08);border:1px solid rgba(245,196,104,0.25);margin-bottom:12px;}' +
      '.oac-explain-current code{background:rgba(0,0,0,0.4);padding:1px 5px;border-radius:4px;color:#fde68a;font-size:12px;}' +
      '.oac-explain-current p{margin:0;color:#cbd5e1;font-size:13px;line-height:1.5;}' +
      '.oac-explain-history{display:flex;flex-direction:column;gap:6px;}' +
      '.oac-explain-item{padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.25);font-size:12px;color:#94a3b8;line-height:1.5;}' +
      '.oac-explain-item code{background:rgba(56,118,252,0.15);padding:1px 5px;border-radius:4px;color:#bfdbfe;}' +
      '.oac-foot{padding:12px 18px;border-top:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:rgba(0,0,0,0.2);}' +
      '.oac-progress{flex:1;min-width:160px;height:8px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;}' +
      '.oac-progress-fill{height:100%;background:linear-gradient(90deg,#38bdf8,#f5c468);transition:width .3s;}' +
      '.oac-foot-status{color:#cbd5e1;font-size:13px;}' +
      '.oac-foot-actions{display:flex;gap:8px;}' +
      '.oac-btn{padding:9px 16px;border-radius:8px;border:1px solid rgba(120,180,255,0.35);background:rgba(56,118,252,0.18);color:#bfdbfe;font-weight:600;cursor:pointer;font-size:13px;}' +
      '.oac-btn:disabled{opacity:0.4;cursor:not-allowed;}' +
      '.oac-btn-primary{background:linear-gradient(135deg,#f5c468,#f59e0b);color:#1a1a1a;border-color:transparent;}' +
      '.oac-output{margin-top:12px;padding:10px;border-radius:8px;background:#020617;border:1px solid rgba(56,189,248,0.3);font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#86efac;white-space:pre-wrap;}' +
      '@media (max-width:820px){.oac-body{grid-template-columns:1fr;height:auto;max-height:none;}.oac-sidebar{border-right:none;border-bottom:1px solid rgba(255,255,255,0.07);max-height:140px;display:flex;gap:6px;overflow-x:auto;}.oac-lesson-btn{flex:0 0 auto;min-width:160px;}.oac-workspace{grid-template-columns:1fr;}.oac-editor{border-right:none;border-bottom:1px solid rgba(255,255,255,0.07);}}';
    document.head.appendChild(st);
  }

  function openAcademy() {
    injectStyles();
    var existing = document.getElementById('ostAcademyModal');
    if (existing) { existing.remove(); }

    var modal = document.createElement('div');
    modal.id = 'ostAcademyModal';
    modal.className = 'oac-modal';
    modal.innerHTML =
      '<div class="oac-card">' +
        '<div class="oac-head">' +
          '<div class="oac-title">💻 OST Code Academy <span style="color:#94a3b8;font-weight:400;font-size:13px;">· from zero to builder</span></div>' +
          '<div style="display:flex;align-items:center;gap:14px;">' +
            '<span class="oac-balance">Balance: <strong data-ostg-balance>0.00</strong> OST</span>' +
            '<button class="oac-close" id="oacClose">×</button>' +
          '</div>' +
        '</div>' +
        '<div class="oac-body">' +
          '<aside class="oac-sidebar" id="oacSidebar"></aside>' +
          '<section class="oac-main">' +
            '<div class="oac-intro" id="oacIntro"></div>' +
            '<div class="oac-workspace">' +
              '<div class="oac-editor" id="oacEditor"></div>' +
              '<div class="oac-explain" id="oacExplain">' +
                '<h5>What you just typed</h5>' +
                '<div class="oac-explain-current" id="oacCurrent"><p>Pick a lesson on the left to begin.</p></div>' +
                '<h5>Lines mastered this lesson</h5>' +
                '<div class="oac-explain-history" id="oacHistory"></div>' +
              '</div>' +
            '</div>' +
            '<div class="oac-foot">' +
              '<div class="oac-progress"><div class="oac-progress-fill" id="oacProgress" style="width:0;"></div></div>' +
              '<span class="oac-foot-status" id="oacStatus">Ready when you are.</span>' +
              '<div class="oac-foot-actions">' +
                '<button class="oac-btn" id="oacHint">Help me type</button>' +
                '<button class="oac-btn" id="oacRun" disabled>▶ Run</button>' +
                '<button class="oac-btn oac-btn-primary" id="oacClaim" disabled>Claim reward</button>' +
              '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('oacClose').addEventListener('click', function () { modal.remove(); });

    paintSidebar();

    // Auto-pick first non-completed lesson, else first
    var academy = loadAcademy();
    var done = academy.completed || {};
    var pick = LESSONS.find(function (l) { return !done[l.id]; }) || LESSONS[0];
    loadLesson(pick.id);

    document.querySelectorAll('[data-ostg-balance]').forEach(function (e) {
      e.textContent = Number(loadBank().credits || 0).toFixed(2);
    });
  }

  function paintSidebar() {
    var sb = document.getElementById('oacSidebar');
    if (!sb) return;
    var done = (loadAcademy().completed || {});
    sb.innerHTML = LESSONS.map(function (l) {
      var cls = 'oac-lesson-btn' + (done[l.id] ? ' is-done' : '');
      return '<button class="' + cls + '" data-id="' + l.id + '">' +
        l.title + '<span class="oac-lesson-level">' + l.level + '</span></button>';
    }).join('');
    sb.addEventListener('click', function (e) {
      var b = e.target.closest('.oac-lesson-btn');
      if (b) loadLesson(b.dataset.id);
    });
  }

  var current = null;

  function loadLesson(id) {
    var lesson = LESSONS.find(function (l) { return l.id === id; });
    if (!lesson) return;
    current = { lesson: lesson, idx: 0, history: [], claimed: false };

    document.querySelectorAll('#oacSidebar .oac-lesson-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.id === id);
    });

    document.getElementById('oacIntro').innerHTML =
      '<h4>' + escapeHtml(lesson.title) + ' · earn ' + lesson.reward + ' OST</h4>' +
      '<p>' + escapeHtml(lesson.intro) + '</p>';

    var ed = document.getElementById('oacEditor');
    ed.innerHTML = lesson.lines.map(function (ln, i) {
      return '<div class="oac-line" data-i="' + i + '">' +
        '<div class="oac-line-num">' + (i + 1) + '</div>' +
        '<div class="oac-line-content">' +
          '<div class="oac-line-target">' + escapeHtml(ln.code) + '</div>' +
          '<input class="oac-line-input" data-i="' + i + '" autocomplete="off" autocapitalize="off" spellcheck="false" autocorrect="off" placeholder="type the line above…">' +
        '</div>' +
      '</div>';
    }).join('');

    ed.querySelectorAll('.oac-line-input').forEach(function (input) {
      input.addEventListener('input', onType);
      input.addEventListener('paste', function (e) { e.preventDefault(); }); // no cheating!
    });

    setActive(0);
    refreshExplain();
    refreshFoot();

    document.getElementById('oacRun').disabled = !lesson.run;
    document.getElementById('oacRun').onclick = function () { runLesson(); };
    document.getElementById('oacHint').onclick = function () { helpTypeActiveLine(); };
    document.getElementById('oacClaim').onclick = function () { claimReward(); };
  }

  function setActive(i) {
    var lines = document.querySelectorAll('#oacEditor .oac-line');
    lines.forEach(function (el, k) {
      el.classList.toggle('is-active', k === i);
    });
    var inp = document.querySelector('#oacEditor .oac-line-input[data-i="' + i + '"]');
    if (inp) { inp.disabled = false; inp.focus(); }
  }

  function onType(e) {
    if (!current) return;
    var i = parseInt(e.currentTarget.dataset.i, 10);
    if (i !== current.idx) return; // only the active line is editable
    var target = current.lesson.lines[i].code;
    var typed = e.currentTarget.value;
    var ok = typed === target;
    var partial = target.indexOf(typed) === 0;
    e.currentTarget.classList.toggle('is-mismatch', !partial);
    if (ok) {
      // Mark line done
      var lineEl = e.currentTarget.closest('.oac-line');
      lineEl.classList.remove('is-active');
      lineEl.classList.add('is-done');
      e.currentTarget.disabled = true;
      current.history.push(current.lesson.lines[i]);
      current.idx += 1;
      refreshExplain();
      refreshFoot();
      if (current.idx < current.lesson.lines.length) {
        setActive(current.idx);
      } else {
        finishLesson();
      }
    } else {
      refreshExplain(); // show explanation while typing too
    }
  }

  function helpTypeActiveLine() {
    if (!current || current.idx >= current.lesson.lines.length) return;
    var input = document.querySelector('#oacEditor .oac-line-input[data-i="' + current.idx + '"]');
    if (!input) return;
    var target = current.lesson.lines[current.idx].code;
    if (target.indexOf(input.value) !== 0) input.value = '';
    input.value = target.slice(0, input.value.length + 1);
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function refreshExplain() {
    if (!current) return;
    var idx = Math.min(current.idx, current.lesson.lines.length - 1);
    var line = current.lesson.lines[idx];
    var cur = document.getElementById('oacCurrent');
    if (current.idx >= current.lesson.lines.length) {
      cur.innerHTML = '<p style="color:#86efac;">🎉 Lesson complete — every line typed and explained.</p>';
    } else {
      cur.innerHTML = '<p><code>' + escapeHtml(line.code) + '</code></p>' +
        '<p style="margin-top:6px;">' + line.why + '</p>';
    }
    var hist = document.getElementById('oacHistory');
    hist.innerHTML = current.history.length === 0
      ? '<div style="color:#475569;font-size:12px;">Nothing yet — every correct line will appear here as a quick reference.</div>'
      : current.history.map(function (h) {
          return '<div class="oac-explain-item"><code>' + escapeHtml(h.code) + '</code><br>' + h.why + '</div>';
        }).reverse().join('');
  }

  function refreshFoot() {
    if (!current) return;
    var pct = Math.round((current.idx / current.lesson.lines.length) * 100);
    document.getElementById('oacProgress').style.width = pct + '%';
    document.getElementById('oacStatus').textContent = current.idx + ' / ' + current.lesson.lines.length + ' lines · ' + pct + '% · type the yellow line';
    document.getElementById('oacClaim').disabled = !(current.idx >= current.lesson.lines.length && !current.claimed);
  }

  function runLesson() {
    if (!current || !current.lesson.run) return;
    var out = current.lesson.run();
    var ed = document.getElementById('oacExplain');
    var existing = document.getElementById('oacOutput');
    if (existing) existing.remove();
    var box = document.createElement('div');
    box.id = 'oacOutput';
    box.className = 'oac-output';
    box.textContent = '> ' + out.join('\n> ');
    ed.appendChild(box);
  }

  function finishLesson() {
    document.getElementById('oacStatus').textContent = '✅ All lines typed correctly. Claim your reward.';
    document.getElementById('oacClaim').disabled = false;
  }

  function claimReward() {
    if (!current || current.claimed) return;
    current.claimed = true;
    award(current.lesson.reward, 'academy:' + current.lesson.id);
    var academy = loadAcademy();
    academy.completed = academy.completed || {};
    academy.completed[current.lesson.id] = Date.now();
    saveAcademy(academy);
    paintSidebar();
    document.getElementById('oacSidebar').querySelectorAll('.oac-lesson-btn').forEach(function (b) {
      if (b.dataset.id === current.lesson.id) b.classList.add('is-done', 'is-active');
    });
    var cur = document.getElementById('oacCurrent');
    cur.innerHTML = '<p style="color:#86efac;">+ ' + current.lesson.reward + ' OST credited to your bonus balance. Pick another lesson →</p>';
    document.getElementById('oacClaim').disabled = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Hijack the existing faucet-hub button so we don't have to edit it
  // ────────────────────────────────────────────────────────────────────────
  function attach() {
    var btn = document.getElementById('fhTaskBtn');
    if (!btn) { setTimeout(attach, 600); return; }
    // Replace listeners by cloning the node
    var clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.disabled = false;
    clone.textContent = '💻 Open Code Academy';
    clone.addEventListener('click', openAcademy);
  }

  // Public hook
  window.OST_OPEN_CODE_ACADEMY = openAcademy;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(attach, 800); });
  } else {
    setTimeout(attach, 800);
  }
})();
