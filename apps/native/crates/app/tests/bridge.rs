use moduo_app::runtime::{self, spawn_io};
use moduo_ui::gpui::{self, AppContext as _, TestAppContext};

struct Counter(u32);

#[gpui::test]
async fn a_tokio_futures_result_reaches_a_gpui_entity(cx: &mut TestAppContext) {
    // The future runs on tokio's threads, so the test scheduler has to wait for a real wake-up.
    cx.executor().allow_parking();
    cx.update(runtime::init);
    let counter = cx.new(|_| Counter(0));

    let task = cx.update(|cx| {
        spawn_io(cx, async {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            // Only a tokio worker has a current runtime handle.
            assert!(tokio::runtime::Handle::try_current().is_ok());
            41 + 1
        })
    });
    let value = task.await;
    counter.update(cx, |c, _| c.0 = value);
    assert_eq!(counter.read_with(cx, |c, _| c.0), 42);
}
