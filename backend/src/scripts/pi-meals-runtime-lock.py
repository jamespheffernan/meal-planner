#!/usr/bin/env python3
"""Unix lifetime lock: stable inode, kernel ownership, stdin EOF releases it."""
import errno
import fcntl
import os
import sys

with open(sys.argv[1], 'a+', encoding='utf-8') as lock:
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit('Pi Meals runtime is already owned by another process.')
    lock.seek(0)
    previous = lock.read().strip()
    if previous:
        if not previous.isdecimal() or int(previous) <= 0:
            sys.exit('Pi Meals runtime has an invalid owner lock; inspect it before reopening.')
        try:
            os.kill(int(previous), 0)
        except OSError as error:
            if error.errno != errno.ESRCH:
                raise
        else:
            sys.exit(f'Pi Meals runtime is already owned by process {previous}.')
    lock.seek(0)
    lock.truncate()
    lock.write(sys.argv[2])
    lock.flush()
    os.fsync(lock.fileno())
    print('ready', flush=True)
    sys.stdin.buffer.read()
    lock.seek(0)
    lock.truncate()
    lock.flush()
    os.fsync(lock.fileno())
