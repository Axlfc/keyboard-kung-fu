class VirtualFS {
    constructor() {
        this.root = { type: 'dir', children: {}, permissions: '755', owner: 'root', group: 'root', mtime: new Date(), size: 4096 };
        this.cwd = '/home/user';
        this._init();
    }

    _init() {
        this.mkdir('/home', 'root', 'root');
        this.mkdir('/home/user', 'user', 'user');
        this.mkdir('/tmp', 'root', 'root', '1777');
        this.mkdir('/bin', 'root', 'root');
        this.mkdir('/usr', 'root', 'root');
        this.mkdir('/usr/bin', 'root', 'root');
        this.mkdir('/etc', 'root', 'root');
        this.mkdir('/var', 'root', 'root');
        this.mkdir('/var/log', 'root', 'root');
        this.writeFile('/etc/hostname', 'bash-master', '644', 'root', 'root');
        this.writeFile('/etc/passwd', 'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:user:/home/user:/bin/bash', '644', 'root', 'root');
        this.writeFile('/etc/shadow', 'root:*:19000:0:99999:7:::', '600', 'root', 'root');
        this.writeFile('/usr/bin/sudo', 'BINARY', '4755', 'root', 'root');
    }

    _resolvePath(path) {
        if (!path) return this.cwd;
        if (path === '~') return '/home/user';
        if (path.startsWith('~/')) path = '/home/user' + path.slice(1);
        if (!path.startsWith('/')) {
            path = (this.cwd === '/' ? '' : this.cwd) + '/' + path;
        }
        const parts = path.split('/').filter(p => p && p !== '.');
        const resolved = [];
        for (const part of parts) {
            if (part === '..') {
                resolved.pop();
            } else {
                resolved.push(part);
            }
        }
        return '/' + resolved.join('/');
    }

    _getNode(path) {
        const resolved = this._resolvePath(path);
        if (resolved === '/') return this.root;
        const parts = resolved.split('/').filter(p => p);
        let curr = this.root;
        for (const part of parts) {
            if (!curr.children || !curr.children[part]) return null;
            curr = curr.children[part];
        }
        return curr;
    }

    mkdir(path, owner = 'user', group = 'user', permissions = '755', recursive = false) {
        if (recursive) {
            const resolved = this._resolvePath(path);
            const parts = resolved.split('/').filter(p => p);
            let curr = '';
            for (const part of parts) {
                curr += '/' + part;
                if (!this.exists(curr)) {
                    this.mkdir(curr, owner, group, permissions, false);
                }
            }
            return true;
        }
        const resolved = this._resolvePath(path);
        const parts = resolved.split('/').filter(p => p);
        const name = parts.pop();
        const parentPath = '/' + parts.join('/');
        const parent = this._getNode(parentPath);
        if (parent && parent.type === 'dir') {
            if (parent.children[name]) return false;
            parent.children[name] = {
                type: 'dir',
                children: {},
                permissions,
                owner,
                group,
                mtime: new Date(),
                size: 4096
            };
            return true;
        }
        return false;
    }

    writeFile(path, content = '', permissions = '644', owner = 'user', group = 'user') {
        const resolved = this._resolvePath(path);
        const parts = resolved.split('/').filter(p => p);
        const name = parts.pop();
        const parentPath = '/' + parts.join('/');
        const parent = this._getNode(parentPath);
        if (parent && parent.type === 'dir') {
            parent.children[name] = {
                type: 'file',
                content,
                permissions,
                owner,
                group,
                mtime: new Date(),
                size: content.length
            };
            return true;
        }
        return false;
    }

    readFile(path) {
        const node = this._getNode(path);
        if (node && node.type === 'symlink') return this.readFile(node.target);
        return (node && node.type === 'file') ? node.content : null;
    }

    ls(path = '.') {
        const node = this._getNode(path);
        if (node && (node.type === 'dir')) {
            return Object.keys(node.children);
        }
        return null;
    }

    rm(path, recursive = false) {
        const resolved = this._resolvePath(path);
        if (resolved === '/' || resolved === '/home' || resolved === '/home/user') return false;
        const parts = resolved.split('/').filter(p => p);
        const name = parts.pop();
        const parentPath = '/' + parts.join('/');
        const parent = this._getNode(parentPath);
        if (parent && parent.children[name]) {
            if (parent.children[name].type === 'dir' && !recursive && Object.keys(parent.children[name].children).length > 0) {
                return false;
            }
            delete parent.children[name];
            return true;
        }
        return false;
    }

    exists(path) {
        return this._getNode(path) !== null;
    }

    chmod(path, mode) {
        const node = this._getNode(path);
        if (node) {
            node.permissions = mode;
            return true;
        }
        return false;
    }

    ln(src, dst, symlink = false) {
        const srcNode = this._getNode(src);
        if (!srcNode && !symlink) return false;
        const resolvedDst = this._resolvePath(dst);
        const parts = resolvedDst.split('/').filter(p => p);
        const name = parts.pop();
        const parent = this._getNode('/' + parts.join('/'));
        if (parent && parent.type === 'dir') {
            parent.children[name] = symlink ? { type: 'symlink', target: src, permissions: '777', owner: 'user', group: 'user', mtime: new Date(), size: src.length } : srcNode;
            return true;
        }
        return false;
    }
}

class Shell {
    constructor(fs) {
        this.fs = fs;
        this.env = {
            HOME: '/home/user',
            PATH: '/usr/local/bin:/usr/bin:/bin',
            USER: 'user',
            SHELL: '/bin/bash',
            PWD: '/home/user',
            TERM: 'xterm-256color'
        };
        this.aliases = {};
        this.history = [];
        this.lastExitCode = 0;
        this.functions = {};
        this.variables = {};
    }

    getPS1() {
        const relPwd = this.fs.cwd.replace(this.env.HOME, '~');
        return `\x1b[32m${this.env.USER}@bashmaster\x1b[0m:\x1b[34m${relPwd}\x1b[0m$ `;
    }

    execute(line) {
        line = line.trim();
        if (!line) return { stdout: '', stderr: '', code: 0 };

        // Handle Variable Assignments
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) {
            const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
            let val = match[2];
            if (val.startsWith('(') && val.endsWith(')')) {
                this.variables[match[1]] = val.slice(1, -1).split(/\s+/);
            } else {
                this.variables[match[1]] = val.replace(/^['"]|['"]$/g, '');
            }
            return { stdout: '', stderr: '', code: 0 };
        }

        // Command Substitution $(cmd)
        line = line.replace(/\$\((.*?)\)/g, (_, cmd) => {
            const res = this.execute(cmd);
            return res.stdout.trim();
        });

        // Basic for loop support
        if (line.startsWith('for ')) {
            const match = line.match(/for\s+(\w+)\s+in\s+([^;]+);\s*do\s+(.+);\s*done/);
            if (match) {
                const [_, varName, items, body] = match;
                const itemList = items.trim().split(/\s+/);
                let fullStdout = '';
                for (const item of itemList) {
                    this.variables[varName] = item;
                    const res = this.execute(body);
                    fullStdout += res.stdout;
                }
                return { stdout: fullStdout, stderr: '', code: 0 };
            }
        }

        // Basic if support
        if (line.startsWith('if ')) {
            const match = line.match(/if\s+\[\s+(.*?)\s+\];\s*then\s+(.*?);\s*fi/);
            if (match) {
                const [_, condition, body] = match;
                const condRes = this._evalCondition(condition);
                if (condRes) return this.execute(body);
                return { stdout: '', stderr: '', code: 0 };
            }
        }

        // Logical operators
        if (line.includes(' && ')) {
            const parts = line.split(' && ');
            let res = { stdout: '', stderr: '', code: 0 };
            for (const part of parts) {
                res = this.execute(part);
                if (res.code !== 0) break;
            }
            return res;
        }

        // Pipes
        if (line.includes(' | ')) {
            const stages = line.split(' | ');
            let lastOutput = null;
            for (const stage of stages) {
                const res = this._execSingle(stage, lastOutput);
                if (res.code !== 0 && stage !== stages[stages.length-1]) return res;
                lastOutput = res.stdout;
            }
            return { stdout: lastOutput, stderr: '', code: 0 };
        }

        return this._execSingle(line);
    }

    _evalCondition(cond) {
        const parts = cond.split(/\s+/);
        if (parts[0] === '-f') return this.fs.exists(parts[1]) && this.fs._getNode(parts[1]).type === 'file';
        if (parts[0] === '-d') return this.fs.exists(parts[1]) && this.fs._getNode(parts[1]).type === 'dir';
        if (parts[1] === '==') return parts[0] === parts[2];
        return false;
    }

    _execSingle(line, stdin = null) {
        // Redirection
        if (line.includes(' >> ')) {
            const [cmd, file] = line.split(' >> ').map(s => s.trim());
            const res = this._execSingle(cmd, stdin);
            if (res.code === 0) {
                const existing = this.fs.readFile(file) || '';
                this.fs.writeFile(file, existing + res.stdout);
            }
            return { stdout: '', stderr: res.stderr, code: res.code };
        }
        if (line.includes(' > ')) {
            const [cmd, file] = line.split(' > ').map(s => s.trim());
            const res = this._execSingle(cmd, stdin);
            if (res.code === 0) {
                this.fs.writeFile(file, res.stdout);
            }
            return { stdout: '', stderr: res.stderr, code: res.code };
        }
        if (line.includes(' 2> ')) {
            const [cmd, file] = line.split(' 2> ').map(s => s.trim());
            const res = this._execSingle(cmd, stdin);
            if (res.stderr) this.fs.writeFile(file, res.stderr);
            return { stdout: res.stdout, stderr: '', code: res.code };
        }
        if (line.includes(' <<< ')) {
            const [cmd, str] = line.split(' <<< ').map(s => s.trim());
            return this._execSingle(cmd, str.replace(/^['"]|['"]$/g, ''));
        }

        const parts = line.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g).map(s => {
            if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
            if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
            return s;
        });

        let cmd = parts[0];
        const args = parts.slice(1);

        if (this.aliases[cmd]) return this.execute(this.aliases[cmd] + ' ' + args.join(' '));

        // Expansion
        const expandedArgs = args.map(arg => arg.replace(/\$([A-zA-Z0-9_?]+)/g, (_, name) => {
            if (name === '?') return this.lastExitCode;
            if (name === '#') return args.length;
            return this.variables[name] || this.env[name] || '';
        }));

        let res = { stdout: '', stderr: '', code: 0 };

        switch (cmd) {
            case 'ls':
                const long = expandedArgs.includes('-l');
                const all = expandedArgs.includes('-a');
                let targetLs = expandedArgs.find(a => !a.startsWith('-')) || '.';
                const entries = this.fs.ls(targetLs);
                if (!entries) {
                    res = { stdout: '', stderr: `ls: ${targetLs}: No such file or directory`, code: 1 };
                } else {
                    let filtered = all ? entries.concat(['.', '..']) : entries.filter(e => !e.startsWith('.'));
                    if (long) {
                        res.stdout = filtered.map(e => {
                            const node = this.fs._getNode(targetLs + '/' + e);
                            if (!node) return '';
                            const type = node.type === 'dir' ? 'd' : (node.type === 'symlink' ? 'l' : '-');
                            return `${type}${node.permissions} 1 ${node.owner} ${node.group} ${node.size} Jan 01 00:00 ${e}`;
                        }).join('\n');
                    } else {
                        res.stdout = filtered.join('  ');
                    }
                }
                break;
            case 'cd':
                const dir = expandedArgs[0] || this.env.HOME;
                if (this.fs.exists(dir) && (this.fs._getNode(dir).type === 'dir')) {
                    this.fs.cwd = this.fs._resolvePath(dir);
                    this.env.PWD = this.fs.cwd;
                } else {
                    res = { stdout: '', stderr: `cd: ${dir}: No such directory`, code: 1 };
                }
                break;
            case 'pwd': res.stdout = this.fs.cwd; break;
            case 'echo': res.stdout = expandedArgs.join(' '); break;
            case 'mkdir':
                const isP = expandedArgs.includes('-p');
                const pathMk = expandedArgs.find(a => !a.startsWith('-'));
                if (!pathMk) { res.stderr = 'mkdir: missing operand'; res.code = 1; break; }
                if (!this.fs.mkdir(pathMk, 'user', 'user', '755', isP)) { res.stderr = `mkdir: cannot create directory '${pathMk}'`; res.code = 1; }
                break;
            case 'touch':
                if (!expandedArgs[0]) { res.stderr = 'touch: missing file operand'; res.code = 1; break; }
                this.fs.writeFile(expandedArgs[0]);
                break;
            case 'cat':
                if (!expandedArgs[0] && !stdin) { res.stderr = 'cat: missing file'; res.code = 1; break; }
                if (!expandedArgs[0] && stdin) { res.stdout = stdin; break; }
                const content = this.fs.readFile(expandedArgs[0]);
                if (content === null) { res.stderr = `cat: ${expandedArgs[0]}: No such file`; res.code = 1; }
                else res.stdout = content;
                break;
            case 'rm':
                this.fs.rm(expandedArgs[expandedArgs.length-1], expandedArgs.includes('-r'));
                break;
            case 'cp':
                const srcCp = expandedArgs[0]; const dstCp = expandedArgs[1];
                const srcNodeCp = this.fs._getNode(srcCp);
                if (srcNodeCp && srcNodeCp.type === 'file') this.fs.writeFile(dstCp, srcNodeCp.content, srcNodeCp.permissions, srcNodeCp.owner, srcNodeCp.group);
                else { res.stderr = `cp: cannot stat '${srcCp}'`; res.code = 1; }
                break;
            case 'mv':
                const msrcMv = expandedArgs[0]; const mdstMv = expandedArgs[1];
                const msrcNodeMv = this.fs._getNode(msrcMv);
                if (msrcNodeMv) {
                    if (this.fs.writeFile(mdstMv, msrcNodeMv.content || '', msrcNodeMv.permissions, msrcNodeMv.owner, msrcNodeMv.group)) this.fs.rm(msrcMv, true);
                } else { res.stderr = `mv: cannot stat '${msrcMv}'`; res.code = 1; }
                break;
            case 'ln':
                const symLn = expandedArgs.includes('-s');
                const lsrcLn = expandedArgs.find(a => !a.startsWith('-'));
                const ldstLn = expandedArgs.find(a => !a.startsWith('-') && a !== lsrcLn);
                if (!this.fs.ln(lsrcLn, ldstLn, symLn)) { res.stderr = `ln: failed to create link`; res.code = 1; }
                break;
            case 'find':
                const fpathFind = expandedArgs.find(a => !a.startsWith('-')) || '.';
                const fnameFind = expandedArgs.includes('-name') ? expandedArgs[expandedArgs.indexOf('-name')+1] : null;
                const fpermFind = expandedArgs.includes('-perm') ? expandedArgs[expandedArgs.indexOf('-perm')+1] : null;
                const resultsFind = [];
                const traverseFind = (p, name, node) => {
                    let match = true;
                    if (fnameFind && !name.includes(fnameFind.replace(/\*/g,''))) match = false;
                    if (fpermFind && node.permissions !== fpermFind.replace('-','')) match = false;
                    if (match) resultsFind.push(p);
                    if (node.children) {
                        Object.entries(node.children).forEach(([childName, childNode]) => {
                            traverseFind(p + (p === '/' ? '' : '/') + childName, childName, childNode);
                        });
                    }
                };
                const startNodeFind = this.fs._getNode(fpathFind);
                if (startNodeFind) traverseFind(this.fs._resolvePath(fpathFind), fpathFind.split('/').pop() || '/', startNodeFind);
                res.stdout = resultsFind.join('\n');
                break;
            case 'head':
                let n_head = 10;
                if (expandedArgs[0] === '-n') n_head = parseInt(expandedArgs[1]);
                let txt_head = stdin || this.fs.readFile(expandedArgs[expandedArgs.length-1]);
                res.stdout = (txt_head || '').split('\n').slice(0, n_head).join('\n');
                break;
            case 'tail':
                let n_tail = 10;
                if (expandedArgs[0] === '-n') n_tail = parseInt(expandedArgs[1]);
                let txt_tail = stdin || this.fs.readFile(expandedArgs[expandedArgs.length-1]);
                const lines_tail = (txt_tail || '').split('\n');
                res.stdout = lines_tail.slice(Math.max(0, lines_tail.length - n_tail)).join('\n');
                break;
            case 'grep':
                const patternGrep = expandedArgs.find(a => !a.startsWith('-'));
                const fileGrep = expandedArgs.find(a => !a.startsWith('-') && a !== patternGrep);
                let txtGrep = stdin || (fileGrep ? this.fs.readFile(fileGrep) : null);
                if (txtGrep) res.stdout = txtGrep.split('\n').filter(l => l.includes(patternGrep)).join('\n');
                break;
            case 'sed':
                const exprSed = expandedArgs[0]; const fileSed = expandedArgs[1];
                let txtSed = stdin || this.fs.readFile(fileSed);
                if (txtSed && exprSed.startsWith('s/')) {
                    const parts = exprSed.split('/');
                    const re = new RegExp(parts[1], parts[3] || '');
                    res.stdout = txtSed.split('\n').map(l => l.replace(re, parts[2])).join('\n');
                }
                break;
            case 'awk':
                const progAwk = expandedArgs.find(a => a.startsWith('{'));
                const fileAwk = expandedArgs.find(a => !a.startsWith('-') && a !== progAwk);
                let txtAwk = stdin || this.fs.readFile(fileAwk);
                if (txtAwk && progAwk) {
                    const fieldMatch = progAwk.match(/\$(\d+)/);
                    const col = fieldMatch ? parseInt(fieldMatch[1]) : 0;
                    const sep = expandedArgs.includes('-F') ? expandedArgs[expandedArgs.indexOf('-F')+1] : /\s+/;
                    res.stdout = txtAwk.split('\n').map(l => {
                        const fields = l.trim().split(sep);
                        return col === 0 ? l : (fields[col-1] || '');
                    }).join('\n');
                }
                break;
            case 'cut':
                const delim = expandedArgs.includes('-d') ? expandedArgs[expandedArgs.indexOf('-d')+1] : '\t';
                const field = expandedArgs.includes('-f') ? parseInt(expandedArgs[expandedArgs.indexOf('-f')+1]) : 1;
                const cFile = expandedArgs.find(x=>!x.startsWith('-') && x!==delim && x!==field.toString());
                let cTxt = stdin || (cFile ? this.fs.readFile(cFile) : null);
                if (cTxt) res.stdout = cTxt.split('\n').map(l => l.split(delim)[field-1] || '').join('\n');
                break;
            case 'wc':
                let txtWc = stdin || (expandedArgs.find(x=>!x.startsWith('-')) ? this.fs.readFile(expandedArgs.find(x=>!x.startsWith('-'))) : null);
                if (txtWc) {
                    if (expandedArgs.includes('-l')) res.stdout = txtWc.split('\n').filter(x=>x).length.toString();
                    else res.stdout = `${txtWc.split('\n').filter(x=>x).length} ${txtWc.split(/\s+/).filter(w=>w).length} ${txtWc.length}`;
                }
                break;
            case 'sort':
                let txtSort = stdin || this.fs.readFile(expandedArgs[0]);
                if (txtSort) res.stdout = txtSort.split('\n').sort().join('\n');
                break;
            case 'uniq':
                let txtUniq = stdin || this.fs.readFile(expandedArgs[0]);
                if (txtUniq) {
                    const lines = txtUniq.split('\n');
                    res.stdout = lines.filter((l, i) => l !== lines[i-1]).join('\n');
                }
                break;
            case 'chmod':
                this.fs.chmod(expandedArgs[1], expandedArgs[0]);
                break;
            case 'alias':
                if (!expandedArgs.length) res.stdout = Object.entries(this.aliases).map(([k,v]) => `alias ${k}='${v}'`).join('\n');
                else {
                    const m = expandedArgs.join(' ').match(/([^=]+)=(.*)/);
                    if (m) this.aliases[m[1].trim()] = m[2].replace(/^['"]|['"]$/g, '');
                }
                break;
            case 'whoami': res.stdout = this.env.USER; break;
            case 'id': res.stdout = `uid=1000(${this.env.USER}) gid=1000(${this.env.USER}) groups=1000(${this.env.USER})`; break;
            case 'df': res.stdout = "Filesystem     Size  Used Avail Use% Mounted on\n/dev/sda1       20G   15G  5.0G  75% /"; break;
            case 'free': res.stdout = "              total        used        free      shared  buff/cache   available\nMem:           8192        4096        4096           0           0        4096"; break;
            case 'ps': res.stdout = "  PID TTY          TIME CMD\n    1 pts/0    00:00:00 bash\n  100 pts/0    00:00:00 ps"; break;
            case 'pgrep': res.stdout = "1234"; break;
            case 'uptime': res.stdout = " 12:00:00 up 10 days, 1:00, 1 user, load average: 0.00, 0.01, 0.05"; break;
            case 'clear': res.special = 'clear'; break;
            case 'base64':
                let txtBase64 = stdin || this.fs.readFile(expandedArgs[0]);
                if (txtBase64) res.stdout = btoa(txtBase64);
                break;
            case 'sha256sum':
                res.stdout = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  " + (expandedArgs[0] || '-');
                break;
            case 'curl': res.stdout = "<html><body>Example Domain</body></html>"; break;
            case 'ping': res.stdout = "64 bytes from google.com (142.250.184.206): icmp_seq=1 ttl=117 time=14.5 ms"; break;
            case 'systemctl': res.stdout = "● dbus.service - D-Bus System Message Bus\n   Loaded: loaded (/lib/systemd/system/dbus.service; static; vendor preset: enabled)\n   Active: active (running) since Mon 2024-01-01 00:00:00 UTC; 1h ago"; break;
            case 'tar':
                if (expandedArgs.includes('-czvf')) this.fs.writeFile(expandedArgs[1], "ARCHIVE_DATA");
                break;
            case 'jq':
                if (expandedArgs[0] === '.name') res.stdout = "bash";
                break;
            case 'stat':
                const nodeStat = this.fs._getNode(expandedArgs[0]);
                if (nodeStat) res.stdout = `File: ${expandedArgs[0]}\nSize: ${nodeStat.size}\nAccess: (${nodeStat.permissions}) Uid: (1000/user) Gid: (1000/user)`;
                break;
            case 'ss': res.stdout = "Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\ntcp LISTEN 0 128 0.0.0.0:80 0.0.0.0:*"; break;
            case 'crontab': res.stdout = "# crontab -e to edit"; break;
            case 'xargs':
                const xcmdXargs = expandedArgs[0]; const xargs_innerXargs = (stdin || '').trim().split(/\s+/);
                let xoutXargs = '';
                for (const arg of xargs_innerXargs) { xoutXargs += this.execute(`${xcmdXargs} ${arg}`).stdout; }
                res.stdout = xoutXargs;
                break;
            case 'tr':
                let txtTr = stdin;
                if (txtTr) {
                    if (expandedArgs[0] === 'A-Z' && expandedArgs[1] === 'a-z') res.stdout = txtTr.toLowerCase();
                    else res.stdout = txtTr;
                }
                break;
            case 'tee': this.fs.writeFile(expandedArgs[0], stdin); res.stdout = stdin; break;
            case 'set': if (expandedArgs[0] === '-x') this.env.DEBUG = true; break;
            case 'type':
                if (this.aliases[expandedArgs[0]]) res.stdout = `${expandedArgs[0]} is aliased to \`${this.aliases[expandedArgs[0]]}'`;
                else res.stdout = `${expandedArgs[0]} is /usr/bin/${expandedArgs[0]}`;
                break;
            default:
                res = { stdout: '', stderr: `${cmd}: command not found`, code: 127 };
        }

        this.lastExitCode = res.code;
        return res;
    }
}

if (typeof module !== 'undefined') {
    module.exports = { VirtualFS, Shell };
}
