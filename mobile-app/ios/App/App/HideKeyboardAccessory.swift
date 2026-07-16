import WebKit
import UIKit

// WKWebView가 텍스트 입력 포커스 시 자동으로 붙이는 키보드 위
// "이전/다음/완료" 툴바(input accessory view)를, 완전히 없애는 대신
// 문구 없는 키보드 닫기 아이콘 하나만 있는 얇은 툴바로 바꿔치기한다.
// (처음엔 통째로 nil 반환해서 완전히 없앴었는데, "완료" 같은 문구가 입력(제출)
// 버튼처럼 보여 혼란을 준다는 문제와, 키보드를 닫을 방법 자체가 사라진다는
// 문제가 둘 다 있었음 — 문구는 빼고 닫는 기능만 남긴 게 이 버전)
// 별도 Capacitor 플러그인 없이, WKWebView 내부에서 실제 텍스트 입력을
// 처리하는 private WKContentView 클래스의 inputAccessoryView를
// 메서드 스위즐링으로 바꿔치기한다.
extension WKWebView {
    static let hideAccessoryBarOnce: Void = {
        print("[accessoryFix] step0: swizzle attempt starting")

        guard let contentViewClass = NSClassFromString("WKContentView") else {
            print("[accessoryFix] step1 FAILED: WKContentView class not found")
            return
        }
        print("[accessoryFix] step1 OK: found WKContentView class")

        let originalSelector = Selector(("inputAccessoryView"))
        guard let originalMethod = class_getInstanceMethod(contentViewClass, originalSelector) else {
            print("[accessoryFix] step2 FAILED: inputAccessoryView method not found on WKContentView")
            return
        }
        print("[accessoryFix] step2 OK: found inputAccessoryView method")

        let newSelector = #selector(getter: WKWebView.wv_customInputAccessoryView)
        guard let newMethod = class_getInstanceMethod(WKWebView.self, newSelector) else {
            print("[accessoryFix] step3 FAILED: wv_customInputAccessoryView method not found")
            return
        }
        print("[accessoryFix] step3 OK: found replacement method")

        method_exchangeImplementations(originalMethod, newMethod)
        print("[accessoryFix] step4 OK: swizzle applied successfully")
    }()

    // 문구(완료/Done 등) 없이, 키보드를 닫는 아이콘 버튼 하나만 있는 얇은 툴바.
    // target을 nil로 두고 action을 resignFirstResponder로 보내면, 현재 포커스를
    // 갖고 있는(=키보드를 띄운) responder에게 그대로 전달되어 키보드가 닫힌다.
    @objc var wv_customInputAccessoryView: UIView? {
        let toolbar = UIToolbar(frame: CGRect(x: 0, y: 0, width: UIScreen.main.bounds.width, height: 38))
        toolbar.barStyle = .default
        toolbar.isTranslucent = true
        let flexSpace = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        let icon = UIImage(systemName: "keyboard.chevron.compact.down")
        let closeItem = UIBarButtonItem(image: icon, style: .plain, target: nil, action: #selector(UIResponder.resignFirstResponder))
        closeItem.accessibilityLabel = "키보드 닫기"
        toolbar.items = [flexSpace, closeItem]
        toolbar.sizeToFit()
        return toolbar
    }

    func hideKeyboardAccessoryBar() {
        _ = WKWebView.hideAccessoryBarOnce
    }
}
