# LarkSub (`@luongndcoder/larksub`)

Plugin [Paseo](https://paseo.sh) giúp quản lý **nhiều tài khoản Lark (`lark-cli`)** và **chuyển đổi tài khoản Lark riêng cho từng phiên (session)** khi nhiều thành viên trong team dùng chung một máy chủ Paseo Web.

Được thiết kế theo triết lý của [`zerosub`](https://github.com/luongndcoder/zerosub), **LarkSub** cho phép mỗi thành viên tự quét mã QR / OAuth ngay trên giao diện Web để thêm tài khoản Lark cá nhân, sau đó chọn tài khoản của mình trên thanh Composer Pill ở mỗi phiên chat mà không làm ảnh hưởng đến các phiên của thành viên khác.

---

## Tính năng chính

- **Quản lý đa tài khoản Lark trên cùng 1 máy host**:
  - Tự động đồng bộ các tài khoản đã đăng nhập sẵn từ `~/.lark-cli/config.json` và Keychain hệ thống.
  - Tạo môi trường cấu hình độc lập cho từng tài khoản tại `~/.paseo/larksub/homes/<accountId>/` dùng chung `appId` và Keychain (`lark-cli-keystore`).
- **Đăng nhập thêm tài khoản qua QR Code / OAuth ngay trên Paseo Web**:
  - Thành viên bấm **`+ Add Account`** (hoặc từ Composer Pill → `Add Lark account…`), chọn phạm vi quyền (`all`, `docs`, `drive`, ...) và quét mã QR bằng ứng dụng Lark trên điện thoại.
- **Chọn tài khoản Lark theo từng phiên (Per-Session Composer Pill)**:
  - Nút pill **`Lark: <Tên tài khoản>`** hiển thị ngay dưới ô nhập chat của mỗi phiên.
  - Khi đổi tài khoản trên Composer Pill, lệnh `lark-cli` tiếp theo trong phiên đó sẽ **chuyển sang tài khoản mới ngay lập tức** mà không cần khởi động lại Agent.
- **Slash Command & Command Center**:
  - Gõ `/lark-account` trong khung chat hoặc mở Command Center (`Cmd+K` → `LarkSub: Manage Lark Accounts`) để quản lý nhanh.

---

## Cài đặt

Yêu cầu Paseo `>= 0.9.1` và đã cài đặt `@larksuite/cli` (`lark-cli`) trên máy host.

### Cài trực tiếp từ GitHub

```bash
paseo plugin install github:luongndcoder/larksub --ref main
```

### Cài từ thư mục local

```bash
git clone https://github.com/luongndcoder/larksub.git
cd larksub
npm install
paseo plugin install ./
```

Kiểm tra trạng thái plugin:

```bash
paseo plugin ls
paseo plugin logs larksub
```

---

## Cơ chế hoạt động

1. **Isolated Account Homes (`~/.paseo/larksub/homes/<accountId>/`)**:
   - `lark-cli` lưu OAuth token của từng người dùng trong hệ thống Keychain theo khóa `${appId}:user:${userOpenId}` và chọn user đang active dựa trên mảng `apps[0].users` trong `$HOME/.lark-cli/config.json`.
   - `larksub` tạo cho mỗi tài khoản một thư mục `$HOME` riêng chỉ chứa đúng `userOpenId` của tài khoản đó, đồng thời symlink `~/Library/Keychains` và `~/Library/Application Support/lark-cli` (trên macOS) hoặc `~/.config/lark-cli` (trên Linux).
2. **Dynamic Per-Session Routing (`~/.paseo/larksub/bin/lark-cli`)**:
   - Khi một phiên Agent mở (`agent.session_open`), `larksub` gắn `PASEO_LARK_SESSION_ID=<agentId>` vào môi trường của phiên.
   - Mỗi khi Agent gọi `lark-cli`, shim của `larksub` tra cứu trực tiếp `sessionBindings[PASEO_LARK_SESSION_ID]` (hoặc `defaultAccountId`) trong `~/.paseo/larksub/state.json` và trỏ `HOME` về đúng thư mục của tài khoản được chọn.

---

## Phát triển

```bash
npm install
npm run typecheck
npm run audit:mobile
paseo plugin reload larksub
```

## License

MIT
