package copilot

import (
	"sync"
	"testing"
)

func TestSession_On(t *testing.T) {
	t.Run("multiple handlers all receive events", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		var received1, received2, received3 bool
		session.On(func(event SessionEvent) { received1 = true })
		session.On(func(event SessionEvent) { received2 = true })
		session.On(func(event SessionEvent) { received3 = true })

		session.dispatchEvent(SessionEvent{Type: "test"})

		if !received1 || !received2 || !received3 {
			t.Errorf("Expected all handlers to receive event, got received1=%v, received2=%v, received3=%v",
				received1, received2, received3)
		}
	})

	t.Run("unsubscribing one handler does not affect others", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		var count1, count2, count3 int
		session.On(func(event SessionEvent) { count1++ })
		unsub2 := session.On(func(event SessionEvent) { count2++ })
		session.On(func(event SessionEvent) { count3++ })

		// First event - all handlers receive it
		session.dispatchEvent(SessionEvent{Type: "test"})

		// Unsubscribe handler 2
		unsub2()

		// Second event - only handlers 1 and 3 should receive it
		session.dispatchEvent(SessionEvent{Type: "test"})

		if count1 != 2 {
			t.Errorf("Expected handler 1 to receive 2 events, got %d", count1)
		}
		if count2 != 1 {
			t.Errorf("Expected handler 2 to receive 1 event (before unsubscribe), got %d", count2)
		}
		if count3 != 2 {
			t.Errorf("Expected handler 3 to receive 2 events, got %d", count3)
		}
	})

	t.Run("calling unsubscribe multiple times is safe", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		var count int
		unsub := session.On(func(event SessionEvent) { count++ })

		session.dispatchEvent(SessionEvent{Type: "test"})

		// Call unsubscribe multiple times - should not panic
		unsub()
		unsub()
		unsub()

		session.dispatchEvent(SessionEvent{Type: "test"})

		if count != 1 {
			t.Errorf("Expected handler to receive 1 event, got %d", count)
		}
	})

	t.Run("handlers are called in registration order", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		var order []int
		session.On(func(event SessionEvent) { order = append(order, 1) })
		session.On(func(event SessionEvent) { order = append(order, 2) })
		session.On(func(event SessionEvent) { order = append(order, 3) })

		session.dispatchEvent(SessionEvent{Type: "test"})

		if len(order) != 3 || order[0] != 1 || order[1] != 2 || order[2] != 3 {
			t.Errorf("Expected handlers to be called in order [1,2,3], got %v", order)
		}
	})

	t.Run("concurrent subscribe and unsubscribe is safe", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		var wg sync.WaitGroup
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				unsub := session.On(func(event SessionEvent) {})
				unsub()
			}()
		}
		wg.Wait()

		// Should not panic and handlers should be empty
		session.handlerMutex.RLock()
		count := len(session.handlers)
		session.handlerMutex.RUnlock()

		if count != 0 {
			t.Errorf("Expected 0 handlers after all unsubscribes, got %d", count)
		}
	})
}

func TestSession_Shutdown(t *testing.T) {
	t.Run("shutdown event dispatches to handlers", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		var received []SessionEvent
		session.On(func(event SessionEvent) {
			received = append(received, event)
		})

		session.dispatchEvent(SessionEvent{Type: "session.shutdown"})

		if len(received) != 1 {
			t.Fatalf("Expected 1 event, got %d", len(received))
		}
		if received[0].Type != "session.shutdown" {
			t.Errorf("Expected session.shutdown event, got %s", received[0].Type)
		}
	})

	t.Run("handlers still active after shutdown flag set", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		var received []SessionEvent
		session.On(func(event SessionEvent) {
			received = append(received, event)
		})

		// Simulate what Shutdown() does: set the flag
		session.isShutdown.Store(true)

		// Handlers should still be active — Shutdown does not clear them
		session.dispatchEvent(SessionEvent{Type: "session.shutdown"})

		if len(received) != 1 {
			t.Fatalf("Expected 1 event after shutdown, got %d", len(received))
		}
		if received[0].Type != "session.shutdown" {
			t.Errorf("Expected session.shutdown, got %s", received[0].Type)
		}
	})

	t.Run("shutdown idempotency via atomic flag", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		// First swap should return false (was not shut down)
		if session.isShutdown.Swap(true) {
			t.Error("Expected first Swap to return false")
		}

		// Second swap should return true (already shut down)
		if !session.isShutdown.Swap(true) {
			t.Error("Expected second Swap to return true")
		}
	})

	t.Run("disconnect clears handlers", func(t *testing.T) {
		session := &Session{
			handlers:     make([]sessionHandler, 0),
			toolHandlers: make(map[string]ToolHandler),
		}

		var count int
		session.On(func(event SessionEvent) { count++ })

		// Dispatch before disconnect — handler should fire
		session.dispatchEvent(SessionEvent{Type: "test"})
		if count != 1 {
			t.Fatalf("Expected 1 event before disconnect, got %d", count)
		}

		// Simulate Disconnect's handler-clearing logic
		session.handlerMutex.Lock()
		session.handlers = nil
		session.handlerMutex.Unlock()

		session.toolHandlersM.Lock()
		session.toolHandlers = nil
		session.toolHandlersM.Unlock()

		session.permissionMux.Lock()
		session.permissionHandler = nil
		session.permissionMux.Unlock()

		// Dispatch after disconnect — handler should NOT fire
		session.dispatchEvent(SessionEvent{Type: "test"})
		if count != 1 {
			t.Errorf("Expected no additional events after disconnect, got %d total", count)
		}
	})

	t.Run("two-phase shutdown then disconnect preserves notification", func(t *testing.T) {
		session := &Session{
			handlers: make([]sessionHandler, 0),
		}

		var events []string
		session.On(func(event SessionEvent) {
			events = append(events, string(event.Type))
		})

		// Phase 1: Shutdown sends the RPC (simulated) — handlers still active
		session.isShutdown.Store(true)

		// Server sends back shutdown notification — handler receives it
		session.dispatchEvent(SessionEvent{Type: "session.shutdown"})

		// Phase 2: Clear handlers (simulating Disconnect)
		session.handlerMutex.Lock()
		session.handlers = nil
		session.handlerMutex.Unlock()

		// Any further events should not reach handlers
		session.dispatchEvent(SessionEvent{Type: "should.not.arrive"})

		if len(events) != 1 {
			t.Fatalf("Expected exactly 1 event, got %d: %v", len(events), events)
		}
		if events[0] != "session.shutdown" {
			t.Errorf("Expected session.shutdown, got %s", events[0])
		}
	})
}
