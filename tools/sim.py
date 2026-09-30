import random, statistics as st

def lines_of(n):
    L = [[r*n+c for c in range(n)] for r in range(n)]
    L += [[r*n+c for r in range(n)] for c in range(n)]
    L += [[i*n+i for i in range(n)], [i*n+(n-1-i) for i in range(n)]]
    return L

def make_card(n, maxnum, column, free):
    if column:
        per = maxnum // n
        cols = [random.sample(range(c*per+1, (c+1)*per+1), n) for c in range(n)]
        cells = [cols[c][r] for r in range(n) for c in range(n)]
    else:
        cells = random.sample(range(1, maxnum+1), n*n)
    if free and n % 2:
        cells[(n*n)//2] = 0
    return cells

def trial(players, n, maxnum, column, free, need, track):
    L = lines_of(n)
    order = list(range(1, maxnum+1)); random.shuffle(order)
    at = {x: i+1 for i, x in enumerate(order)}; at[0] = 0
    done = []
    for _ in range(players):
        cells = make_card(n, maxnum, column, free)
        t = sorted(max(at[cells[i]] for i in ln) for ln in L)
        done.append(t[need-1])
    done.sort()
    return done[0], done.count(done[0]), [done[k-1] for k in track]

def run(name, players, n, maxnum, column, free, need, trials=1500, track=(1,3,5,10)):
    F, T, W = [], [], {k: [] for k in track}
    for _ in range(trials):
        f, tie, w = trial(players, n, maxnum, column, free, need, track)
        F.append(f); T.append(tie)
        for k, v in zip(track, w): W[k].append(v)
    s = sorted(F)
    print(f"{name:26s} {players:3d}人 第1人 P10/中位/P90={s[len(s)//10]}/{st.median(F)}/{s[len(s)*9//10]}  "
          f"同時多人={sum(t>1 for t in T)/len(T):4.0%} 平均{st.mean(T):.1f}人  "
          + " ".join(f"第{k}人={st.median(W[k])}" for k in track[1:]))

random.seed(1)
for p in (150, 200):
    for need in (1, 2, 3):
        run(f"5x5 1-75 分欄 中心免費 {need}線", p, 5, 75, True, True, need)
    run("5x5 1-75 無免費格 3線", p, 5, 75, False, False, 3)
    run("5x5 1-50 中心免費 3線", p, 5, 50, False, True, 3)
    run("5x5 1-40 中心免費 3線", p, 5, 40, False, True, 3)
    print()
