"""Runs INSIDE the untrusted sandbox. No host paths or credentials are exposed.
Bounded text snapshots and compare-before-write projection operations.
"""
import json, os, stat, sys

ROOT = '/workspace'
MAX_FILE = 1024 * 1024
MAX_TOTAL = 25 * MAX_FILE
EXCLUDED = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', '.next', '.nuxt',
            'dist', 'build', 'coverage', 'target', '.meridian-build', '.terminal-sandboxes',
            '.bash_history', '.zsh_history', '.python_history'}

def parts(name):
    if not isinstance(name, str) or len(name.encode()) > 4096:
        raise ValueError('Invalid path')
    result = name.split('/')
    if any(not p or p in ('.', '..') or '\\' in p or any(ord(c) < 32 for c in p) for p in result):
        raise ValueError('Invalid path')
    return result

def parent(name, create=False):
    segments = parts(name)
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for segment in segments[:-1]:
            if create:
                try: os.mkdir(segment, 0o700, dir_fd=fd)
                except FileExistsError: pass
            child = os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd, segments[-1]
    except BaseException:
        os.close(fd)
        raise

def read(name):
    fd, leaf = parent(name)
    try:
        f = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(f)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > MAX_FILE:
                raise ValueError('Unsupported file')
            data = os.read(f, MAX_FILE + 1)
            after = os.fstat(f)
            if len(data) != before.st_size or before.st_mtime_ns != after.st_mtime_ns or b'\0' in data:
                raise ValueError('Unstable or binary file')
            return data.decode('utf-8')
        finally: os.close(f)
    finally: os.close(fd)

def allowed(name):
    return all(p not in EXCLUDED and not p.startswith('.zcompdump') and not p.endswith(('.swp', '.swo', '~')) for p in parts(name))

def snapshot():
    files, folders = {}, []
    count = total = 0
    def visit(fd, prefix='', depth=0):
        nonlocal count, total
        if depth > 64: raise ValueError('Folder depth limit exceeded')
        with os.scandir(fd) as entries:
            for entry in entries:
                count += 1
                if count > 4000: raise ValueError('Entry limit exceeded')
                name = prefix + entry.name
                if not allowed(name): continue
                if entry.is_dir(follow_symlinks=False):
                    child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    try:
                        folders.append(name)
                        visit(child, name + '/', depth + 1)
                    finally: os.close(child)
                elif entry.is_file(follow_symlinks=False):
                    try: content = read(name)
                    except (OSError, ValueError, UnicodeError): continue
                    total += len(content.encode())
                    if len(files) >= 1000 or total > MAX_TOTAL: raise ValueError('Text limit exceeded')
                    files[name] = content
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: visit(fd)
    finally: os.close(fd)
    return {'files': files, 'folders': folders}

def write(name, content):
    if not isinstance(content, str) or len(content.encode()) > MAX_FILE: raise ValueError('File too large')
    fd, leaf = parent(name, True)
    try:
        f = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=fd)
        try:
            s = os.fstat(f)
            if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1: raise ValueError('Unsafe target')
            os.ftruncate(f, 0)
            data = content.encode()
            while data: data = data[os.write(f, data):]
        finally: os.close(f)
    finally: os.close(fd)

def mkdir(name):
    fd, leaf = parent(name, True)
    try:
        try: os.mkdir(leaf, 0o700, dir_fd=fd)
        except FileExistsError:
            if not stat.S_ISDIR(os.stat(leaf, dir_fd=fd, follow_symlinks=False).st_mode): raise
    finally: os.close(fd)

def remove(name):
    # Only remove acknowledged text files. Never recursively remove arbitrary
    # dependencies or terminal work that was excluded from a snapshot.
    fd, leaf = parent(name)
    try: os.unlink(leaf, dir_fd=fd)
    finally: os.close(fd)

def apply(request):
    op = request['op']
    if op == 'seed':
        files = request['files']
        if not isinstance(files, dict) or len(request.get('folders', [])) > 4000:
            raise ValueError('Invalid initial workspace')
        if len(files) > 1000 or sum(len(v.encode()) for v in files.values()) > MAX_TOTAL:
            raise ValueError('Text limit exceeded')
        for name in request.get('folders', []): mkdir(name)
        for name, content in files.items(): write(name, content)
        return {'applied': True}
    if op == 'mkdir':
        mkdir(request['path'])
        return {'applied': True}
    if op == 'write':
        name = request['path']
        try: current = read(name)
        except FileNotFoundError: current = None
        if current != request.get('expected'): return {'applied': False}
        write(name, request['content'])
        return {'applied': True}
    if op in ('delete', 'rename'):
        old = request['path']
        parts(old)
        current = snapshot()['files']
        affected = {k: v for k, v in current.items() if k == old or k.startswith(old + '/')}
        if affected != request['expected']: return {'applied': False}
        if op == 'rename':
            new = request['to']
            parts(new)
            # Preserve destination data rather than replacing it.
            if any(k == new or k.startswith(new + '/') for k in current): return {'applied': False}
            for name, content in affected.items(): write(new + name[len(old):], content)
            if not affected: mkdir(new)
        for name in affected: remove(name)
        # Empty source directories may remain; never remove excluded work.
        return {'applied': True}
    raise ValueError('Unknown operation')

try:
    request = json.loads(sys.stdin.buffer.read(30 * MAX_FILE + 1))
    result = snapshot() if request['op'] == 'snapshot' else apply(request)
    print(json.dumps(result, ensure_ascii=True))
except Exception as error:
    print(json.dumps({'error': str(error)}))
    sys.exit(1)
