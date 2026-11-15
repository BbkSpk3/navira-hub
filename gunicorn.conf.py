# Gunicorn reads this file by itself, so the app runs correctly even when the
# start command is just:  gunicorn app:app
workers = 1          # one copy of the app (it keeps chats and counters in memory)
threads = 8          # so several people can use it at the same time
timeout = 180        # the AI can take over a minute to read a menu or build a page
