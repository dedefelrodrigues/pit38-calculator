## Scenario 1: Simple PLN equity, buy and sell same year

Buy: 100 shares CDPROJKT at 250.00 PLN on 2024-03-01
Sell: 100 shares CDPROJKT at 310.00 PLN on 2024-11-15

Calculation:
Revenue: 100 × 310.00 = 31,000.00 PLN
Cost basis: 100 × 250.00 = 25,000.00 PLN
Net gain: 6,000.00 PLN
Tax (19%): 1,140.00 PLN

## Scenario 2: FIFO — Two Lots, Sell Exactly First Lot

Buy:  60 shares at 40.00 PLN on 2024-01-10   (lot 1)
Buy:  40 shares at 60.00 PLN on 2024-04-20   (lot 2)
Sell: 60 shares at 80.00 PLN on 2024-11-05

FIFO matching:
  60 shares from lot 1 at cost 40.00 PLN   (lot 1 fully consumed)

Remaining after sell:
  0 shares in lot 1
  40 shares remaining in lot 2 at cost 60.00 PLN

Cost basis:  60 × 40.00 = 2,400.00 PLN
Revenue:     60 × 80.00 = 4,800.00 PLN
Net gain:    2,400.00 PLN
Tax (19%):     456.00 PLN

## Scenario 3: FIFO — Two Lots, Partial Sell Crosses Lot Boundary

Buy:  50 shares at 100.00 PLN on 2024-01-10   (lot 1)
Buy:  50 shares at 120.00 PLN on 2024-03-15   (lot 2)
Sell: 70 shares at 150.00 PLN on 2024-10-20

FIFO matching:
  50 shares from lot 1 at cost 100.00 PLN   (lot 1 fully consumed)
  20 shares from lot 2 at cost 120.00 PLN   (lot 2 partially consumed)

Remaining after sell:
  0 shares in lot 1
  30 shares remaining in lot 2 at cost 120.00 PLN

Cost basis:  (50 × 100.00) + (20 × 120.00) = 5,000.00 + 2,400.00 = 7,400.00 PLN
Revenue:     70 × 150.00 = 10,500.00 PLN
Net gain:    3,100.00 PLN
Tax (19%):     589.00 PLN

## Scenario 4: FIFO — Two Lots, Sell All Shares from Both Lots

Buy:  60 shares at 40.00 PLN on 2024-01-10   (lot 1)
Buy:  40 shares at 60.00 PLN on 2024-04-20   (lot 2)
Sell: 100 shares at 80.00 PLN on 2024-11-05

FIFO matching:
  60 shares from lot 1 at cost 40.00 PLN   (lot 1 fully consumed)
  40 shares from lot 2 at cost 60.00 PLN   (lot 2 fully consumed)

Remaining after sell:
  0 shares in lot 1
  0 shares in lot 2

Cost basis:  (60 × 40.00) + (40 × 60.00) = 2,400.00 + 2,400.00 = 4,800.00 PLN
Revenue:     100 × 80.00 = 8,000.00 PLN
Net gain:    3,200.00 PLN
Tax (19%):     608.00 PLN

## Scenario 5: FIFO — Three Lots, Sell Spans All Three

Buy:  30 shares at 50.00 PLN on 2024-01-05   (lot 1)
Buy:  30 shares at 70.00 PLN on 2024-03-10   (lot 2)
Buy:  40 shares at 90.00 PLN on 2024-06-01   (lot 3)
Sell: 80 shares at 110.00 PLN on 2024-12-01

FIFO matching:
  30 shares from lot 1 at cost 50.00 PLN   (lot 1 fully consumed)
  30 shares from lot 2 at cost 70.00 PLN   (lot 2 fully consumed)
  20 shares from lot 3 at cost 90.00 PLN   (lot 3 partially consumed)

Remaining after sell:
  0 shares in lot 1
  0 shares in lot 2
  20 shares remaining in lot 3 at cost 90.00 PLN

Cost basis:  (30 × 50.00) + (30 × 70.00) + (20 × 90.00)
           = 1,500.00 + 2,100.00 + 1,800.00
           = 5,400.00 PLN
Revenue:     80 × 110.00 = 8,800.00 PLN
Net gain:    3,400.00 PLN
Tax (19%):     646.00 PLN

## Scenario 6: FIFO — Two Sequential Sells Deplete Lots in Order

Buy:  50 shares at 100.00 PLN on 2024-01-10   (lot 1)
Buy:  50 shares at 120.00 PLN on 2024-03-15   (lot 2)
Sell: 50 shares at 140.00 PLN on 2024-07-01   (sell 1)
Sell: 50 shares at 160.00 PLN on 2024-11-20   (sell 2)

Sell 1 — FIFO matching:
  50 shares from lot 1 at cost 100.00 PLN   (lot 1 fully consumed)

  Cost basis:  50 × 100.00 = 5,000.00 PLN
  Revenue:     50 × 140.00 = 7,000.00 PLN
  Net gain:    2,000.00 PLN

Sell 2 — FIFO matching:
  50 shares from lot 2 at cost 120.00 PLN   (lot 2 fully consumed)

  Cost basis:  50 × 120.00 = 6,000.00 PLN
  Revenue:     50 × 160.00 = 8,000.00 PLN
  Net gain:    2,000.00 PLN

Annual totals:
  Total revenue:    7,000.00 + 8,000.00 = 15,000.00 PLN
  Total cost basis: 5,000.00 + 6,000.00 = 11,000.00 PLN
  Total net gain:   4,000.00 PLN
  Tax (19%):          760.00 PLN

## Scenario 7: FIFO — Sell at a Loss

Buy:  100 shares at 200.00 PLN on 2024-02-01   (lot 1)
Sell: 100 shares at 150.00 PLN on 2024-09-15

FIFO matching:
  100 shares from lot 1 at cost 200.00 PLN   (lot 1 fully consumed)

Cost basis:  100 × 200.00 = 20,000.00 PLN
Revenue:     100 × 150.00 = 15,000.00 PLN
Net loss:    -5,000.00 PLN
Tax (19%):   0.00 PLN   (loss — no tax due; loss can offset gains in same year)

## Scenario 8: FIFO — Interleaved Buys and Sells, Partial Lot Carry-over

Buy:  40 shares at 80.00 PLN on 2024-01-15   (lot 1)
Sell: 25 shares at 100.00 PLN on 2024-04-10   (sell 1)
Buy:  30 shares at 90.00 PLN on 2024-05-20   (lot 2)
Sell: 35 shares at 110.00 PLN on 2024-10-05   (sell 2)

State before sell 1:
  lot 1: 40 shares @ 80.00 PLN

Sell 1 — FIFO matching:
  25 shares from lot 1 at cost 80.00 PLN

  Cost basis:  25 × 80.00 = 2,000.00 PLN
  Revenue:     25 × 100.00 = 2,500.00 PLN
  Net gain:    500.00 PLN

State after sell 1:
  lot 1: 15 shares @ 80.00 PLN (remaining)

State before sell 2 (after second buy):
  lot 1: 15 shares @ 80.00 PLN
  lot 2: 30 shares @ 90.00 PLN

Sell 2 — FIFO matching:
  15 shares from lot 1 at cost 80.00 PLN   (lot 1 fully consumed)
  20 shares from lot 2 at cost 90.00 PLN   (lot 2 partially consumed)

  Cost basis:  (15 × 80.00) + (20 × 90.00) = 1,200.00 + 1,800.00 = 3,000.00 PLN
  Revenue:     35 × 110.00 = 3,850.00 PLN
  Net gain:    850.00 PLN

State after sell 2:
  lot 1: 0 shares
  lot 2: 10 shares @ 90.00 PLN (remaining)

Annual totals:
  Total revenue:    2,500.00 + 3,850.00 = 6,350.00 PLN
  Total cost basis: 2,000.00 + 3,000.00 = 5,000.00 PLN
  Total net gain:   1,350.00 PLN
  Tax (19%):          256.50 PLN
