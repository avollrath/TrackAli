import requests

# The endpoint you discovered
url = "https://consumer-api.wolt.com/order-tracking-api/v1/order_history/?limit=100"

# HEADERS: Copy these exactly from Chrome DevTools (Right click request -> Copy as cURL/Node fetch if easier)
headers = {
    "Authorization": "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjY5ZjFiYmZjMDAwMDAwMDAwMDAwMDAwMCIsInR5cCI6IngudXNlcitqd3QifQ.eyJhdWQiOlsic3Vic2NyaXB0aW9uLXNlcnZpY2UiLCJwYXltZW50cy10aXBzLXNlcnZpY2UiLCJjb3Jwb3JhdGUtcG9ydGFsLWFwaSIsImxveWFsdHktZ2F0ZXdheSIsInBheW1lbnQtc2VydmljZSIsImNvbnN1bWVyLWFzc29ydG1lbnQiLCJjb3VyaWVyY2xpZW50IiwiYWN0aXZpdHktaHViIiwiaW50ZWdyYXRpb24tY29uZmlnLXNlcnZpY2UiLCJsb3lhbHR5LXByb2dyYW0tYXBpIiwicmVzdGF1cmFudC1hcGkiLCJtZWFsLWJlbmVmaXRzLXNlcnZpY2UiLCJvcmRlci14cCIsImdpZnQtY2FyZC1zaG9wIiwib3JkZXItdHJhY2tpbmciLCJzdXBwb3J0LWZ1bm5lbCIsInRvcHVwLXNlcnZpY2UiLCJkaWZmdXNpb24iLCJsaXN0LWV2ZXJ5dGhpbmctZGF0YXN0b3JlIiwidmVudWUtY29udGVudC1hcGkiLCJ3bHMtY3VzdG9tZXItc2VydmljZSIsInJldHVybnMtYXBpIiwiYWdlbnRpYy1zaG9wcGluZy1zZXJ2aWNlIiwicGVkcmVnYWwiLCJ3b2x0YXV0aCIsImFkLWluc2lnaHRzIiwiZS13YWxsZXQtc2VydmljZSIsImRhYXMtcHVibGljLWFwaSIsImNvbnZlcnNlLXdpZGdldC1jb25zdW1lciJdLCJpc3MiOiJ3b2x0YXV0aCIsImp0aSI6IjdhNTUxMGIyNGUyMjExZjFhZmRiMjY2ZmRkMTZhNDEwIiwidXNlciI6eyJpZCI6IjU3Yjg2OTNjZTE0ZjZkMjgzNzU4Y2M5ZCIsIm5hbWUiOnsiZmlyc3RfbmFtZSI6IkFuZHJcdTAwZTkiLCJsYXN0X25hbWUiOiJWb2xscmF0aCJ9LCJlbWFpbCI6InplZXBoYXQyMDAyQGhvdG1haWwuY29tIiwicm9sZXMiOlsidXNlciJdLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfbnVtYmVyX3ZlcmlmaWVkIjp0cnVlLCJjb3VudHJ5IjoiRklOIiwicGVkcmVnYWxfaWQiOiJjOTlhZWU4Ni01MGZiLTQyNjQtYmI3Zi1lNTg4Yzk3MGU3MzAiLCJsYW5ndWFnZSI6ImVuIiwicHJvZmlsZV9waWN0dXJlIjp7InVybCI6Imh0dHBzOi8vY3JlZGl0b3Jub3RtZWRpYS5zMy5hbWF6b25hd3MuY29tLzA5ZjhhOTNiMDdlZmFjZjYzMDVhYWQ4MWZhNzM4YTIyMDU5ZmVmNDI0MzUyYWQyMmE3ZWQ2ZWRlNGFmYThmMTM1NmYwMTk5M2U0YzJhZmFhNTAwYTgxN2I1ZWZhOGJhNjkyNDIxZGZlZTAwNjk1YzFlNDM5NjUxOTQ3ZTkxMThhIn0sInBlcm1pc3Npb25zIjpbXSwicGhvbmVfbnVtYmVyIjoiKzM1ODQwNjYyNDI2OSIsInRlbmFudCI6IndvbHQiLCJwcm4iOiJwcm46djE6d29sdDppZGVudGl0eTp1c2VyOjU3Yjg2OTNjZTE0ZjZkMjgzNzU4Y2M5ZCJ9LCJpYXQiOjE3Nzg2MDQ1NDEsImV4cCI6MTc3ODYwNjM0MSwiYW1yIjpbXSwic2lkIjoiNjZiZTNjYmUyOTJkZmQ5NmMyODEzNzRiIn0.vsY9hij0CDrLAUbr-E_QQBr8em-AvV9gVLgNr-XYozSmvNhFUHVANtPTEQMRE19UJLqpMKc02tJw5avYqwgPQA",
    "wolt-session-id": "71a00655-a0d8-4d15-a681-9c0a03b1aa53",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...", # Use your actual browser string
}

response = requests.get(url, headers=headers)
response.raise_for_status()
data = response.json()

orders = data.get('orders', [])
count = 1

print(f"{'#':<3} | {'Date':<18} | {'Venue':<30} | {'Price':<8} | {'Items'}")
print("-" * 100)

for order in orders:
    # Only process successful deliveries
    if order.get('status') != "delivered":
        continue
    
    date = order.get('received_at', 'N/A')
    venue = order.get('venue_name', 'Unknown')
    price = order.get('total_amount', '€0.00')
    items = order.get('items', 'No items')

    # Format into a single line
    print(f"{count:<3} | {date:<18} | {venue:<30} | {price:<8} | {items}")
    
    count += 1