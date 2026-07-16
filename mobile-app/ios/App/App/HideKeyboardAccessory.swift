import WebKit

// WKWebView가 텍스트 입력 포커스 시 자동으로 붙이는 키보드 위
// "이전/다음/완료" 툴바(input accessory view)를 전역적으로 제거.
// 별도 Capacitor 플러그인 없이, WKWebView 내부에서 실제 텍스트 입력을
// 처리하는 private WKContentView 클래스의 inputAccessoryView를
// 메서드 스위즐링으로 nil 반환하도록 바꿔치기한다.
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

        let newSelector = #selector(getter: WKWebView.wv_noInputAccessoryView)
        guard let newMethod = class_getInstanceMethod(WKWebView.self, newSelector) else {
            print("[accessoryFix] step3 FAILED: wv_noInputAccessoryView method not found")
            return
        }
        print("[accessoryFix] step3 OK: found replacement method")

        method_exchangeImplementations(originalMethod, newMethod)
        print("[accessoryFix] step4 OK: swizzle applied successfully")
    }()

    @objc var wv_noInputAccessoryView: UIView? { return nil }

    func hideKeyboardAccessoryBar() {
        _ = WKWebView.hideAccessoryBarOnce
    }
}
