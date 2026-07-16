import WebKit
import UIKit

// WKWebView가 텍스트 입력 포커스 시 자동으로 붙이는 키보드 위
// "이전/다음/완료" 툴바(input accessory view)를, 완전히 없애는 대신
// 가운데 정렬된 무채색 아래 삼각형(▼) 버튼 하나만 있는 얇은 툴바로 바꿔치기한다.
// (처음엔 통째로 nil 반환해서 완전히 없앴었는데, "완료" 같은 문구가 입력(제출)
// 버튼처럼 보여 혼란을 준다는 문제와, 키보드를 닫을 방법 자체가 사라진다는
// 문제가 둘 다 있었음. 그다음엔 "숨기기" 문구 + 파란 굵은 글씨(.done 스타일)로
// 바꿨는데 색이 너무 튄다는 피드백을 받아, 문구/색 없이 아이콘 하나만 남긴
// 지금 버전으로 다시 바꿈)
// 별도 Capacitor 플러그인 없이, WKWebView 내부에서 실제 텍스트 입력을
// 처리하는 private WKContentView 클래스의 inputAccessoryView를
// 메서드 스위즐링으로 바꿔치기한다.
// 스위즐된 wv_customInputAccessoryView 안에서는 self가 (원래 메서드의 진짜 주인인)
// WKContentView이지 WKWebView가 아니라서, 그 안에서 evaluateJavaScript를 직접
// 호출할 방법이 없다. 그래서 실제 WKWebView 인스턴스를 별도로 기억해뒀다가,
// 버튼이 눌리면 JS로 document.activeElement를 직접 blur()시킨다.
// (resignFirstResponder만으로는 WKWebView 내부 DOM 포커스 상태까지는 안 풀려서
// 키보드가 그대로 남아있는 경우가 있었음 — 실제로 페이지 쪽 <input>이 blur돼야
// 웹킷이 키보드를 확실히 내린다)
final class KeyboardDismisser {
    static let shared = KeyboardDismisser()
    weak var webView: WKWebView?

    @objc func dismiss() {
        webView?.evaluateJavaScript("document.activeElement && document.activeElement.blur();", completionHandler: nil)
    }
}

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

    // 반투명 회색 바 가운데에 무채색 아래 삼각형(▼) 하나만 놓는다. 글씨도 색도 없이
    // 도형 하나뿐이라 입력(제출) 버튼으로 오해할 일도 없고, 파란 글씨처럼 튀지도 않음.
    // 버튼의 target/action은 KeyboardDismisser.shared로 고정해 실제 웹뷰 인스턴스를
    // 기억해뒀다가 JS blur()로 확실하게 키보드를 닫는다(자세한 이유는 위 주석 참고).
    @objc var wv_customInputAccessoryView: UIView? {
        let toolbar = UIToolbar(frame: CGRect(x: 0, y: 0, width: UIScreen.main.bounds.width, height: 40))
        toolbar.barStyle = .default
        toolbar.isTranslucent = true
        let leftSpace = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        let rightSpace = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        let closeItem = UIBarButtonItem(title: "▼", style: .plain, target: KeyboardDismisser.shared, action: #selector(KeyboardDismisser.dismiss))
        closeItem.tintColor = UIColor(white: 0.45, alpha: 1) // 파란색(시스템 기본 tint) 대신 무채색 회색
        closeItem.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 13, weight: .regular)], for: .normal)
        closeItem.accessibilityLabel = "키보드 닫기"
        toolbar.items = [leftSpace, closeItem, rightSpace]
        toolbar.sizeToFit()
        return toolbar
    }

    // AppDelegate에서 실제 웹뷰가 준비된 시점에 호출해서 KeyboardDismisser에
    // 인스턴스를 등록해준다(스위즐 자체는 인스턴스 없이도 이미 걸려있음).
    func hideKeyboardAccessoryBar() {
        _ = WKWebView.hideAccessoryBarOnce
        KeyboardDismisser.shared.webView = self
    }
}
