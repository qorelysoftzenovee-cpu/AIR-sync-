import os
import time
import wave
import struct
import sys
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.edge.options import Options as EdgeOptions

def generate_dummy_wav(filepath):
    """Generates a valid 1-second silent WAV file at 16kHz mono 16-bit PCM."""
    with wave.open(filepath, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        # Write 16000 samples of silence (value 0)
        for _ in range(16000):
            data = struct.pack('<h', 0)
            wav_file.writeframesraw(data)
    print(f"Generated test audio file: {filepath}")

def generate_dummy_file(filepath, size_kb=10):
    """Generates a dummy text file of specified size in KB."""
    with open(filepath, "w") as f:
        f.write("AirSync Suite WebRTC Direct Chunk Transfer Testing Block. " * (size_kb * 15))
    print(f"Generated test data file: {filepath} ({size_kb} KB)")

def create_driver():
    """Tries initializing Chrome WebDriver; falls back to Edge if Chrome is missing."""
    # Try Chrome
    try:
        chrome_options = ChromeOptions()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--use-fake-ui-for-media-stream")
        chrome_options.add_argument("--use-fake-device-for-media-stream")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        # Allow reading console logs
        chrome_options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
        driver = webdriver.Chrome(options=chrome_options)
        print("Successfully launched Headless Google Chrome.")
        return driver
    except Exception as e:
        print(f"Chrome start failed: {e}. Attempting Edge fallback...")

    # Fallback to Edge
    try:
        edge_options = EdgeOptions()
        edge_options.add_argument("--headless")
        edge_options.add_argument("--use-fake-ui-for-media-stream")
        edge_options.add_argument("--use-fake-device-for-media-stream")
        edge_options.add_argument("--no-sandbox")
        edge_options.add_argument("--disable-dev-shm-usage")
        edge_options.set_capability('ms:loggingPrefs', {'browser': 'ALL'})
        driver = webdriver.Edge(options=edge_options)
        print("Successfully launched Headless Microsoft Edge.")
        return driver
    except Exception as e:
        print(f"Edge start failed: {e}")
        raise RuntimeError("No suitable web driver found. Please ensure Chrome or Edge is installed.")

def run_tests():
    print("====================================================")
    print("          AIRSYNC SUITE INTEGRATION TESTS           ")
    print("====================================================")

    test_file = os.path.abspath("test_data_file.txt")
    test_audio = os.path.abspath("test_audio_file.wav")
    
    generate_dummy_file(test_file, size_kb=15)
    generate_dummy_wav(test_audio)
    
    driver_sender = None
    driver_receiver = None

    try:
        print("\n[Step 1] Initializing browser instances...")
        driver_sender = create_driver()
        driver_receiver = create_driver()

        print(f"\n[Step 2] Loading AirSync app on http://127.0.0.1:8000...")
        driver_sender.get("http://127.0.0.1:8000/#airdrop")
        driver_receiver.get("http://127.0.0.1:8000/#airdrop")
        
        wait_s = WebDriverWait(driver_sender, 15)
        wait_r = WebDriverWait(driver_receiver, 15)

        # Wait for Peer ID generation
        print("\n[Step 3] Fetching Generated Pair Code from Sender...")
        wait_s.until(lambda d: d.find_element(By.ID, "local-peer-id").text != "----")
        pair_code = driver_sender.find_element(By.ID, "local-peer-id").text.strip()
        print(f"-> Pair Code retrieved: {pair_code}")

        # Input code on Receiver and connect
        print(f"\n[Step 4] Inputting Pair Code on Receiver and Connecting...")
        input_box = wait_r.until(EC.presence_of_element_located((By.ID, "remote-peer-id-input")))
        input_box.send_keys(pair_code)
        
        connect_btn = driver_receiver.find_element(By.ID, "connect-peer-btn")
        # Ensure element is in view and use JS click to avoid layout overlap issues in headless
        driver_receiver.execute_script("arguments[0].scrollIntoView(true);", connect_btn)
        time.sleep(1)
        driver_receiver.execute_script("arguments[0].click();", connect_btn)
        print("-> Connection requested. Waiting for WebRTC handshake...")

        # Verify connected state on both
        try:
            wait_s.until(EC.text_to_be_present_in_element((By.ID, "connection-status"), "Connected"))
            wait_r.until(EC.text_to_be_present_in_element((By.ID, "connection-status"), "Connected"))
            print("-> SUCCESS: WebRTC direct data channel connection established!")
        except Exception as e:
            print(f"DEBUG: wait_s status='{driver_sender.find_element(By.ID, 'connection-status').text}'")
            print(f"DEBUG: wait_r status='{driver_receiver.find_element(By.ID, 'connection-status').text}'")
            raise e
        # File Transfer test
        print(f"\n[Step 5] Triggering File Transfer from Sender ({test_file})...")
        file_input = driver_sender.find_element(By.ID, "file-input")
        file_input.send_keys(test_file)
        
        # Wait for Receiver modal dialog
        print("-> Waiting for Receiver acceptance modal...")
        wait_r.until(EC.visibility_of_element_located((By.ID, "incoming-file-modal")))
        print("-> Acceptance modal visible. Accepting file...")
        
        accept_btn = driver_receiver.find_element(By.ID, "accept-file-btn")
        accept_btn.click()
        
        # Wait for completion status
        print("-> Streaming chunks. Waiting for completed status...")
        wait_s.until(EC.text_to_be_present_in_element((By.ID, "connection-status"), "Complete"))
        wait_r.until(EC.text_to_be_present_in_element((By.ID, "connection-status"), "Complete"))
        print("-> SUCCESS: P2P File Transfer completed successfully!")

        # Transcriber test
        print("\n[Step 6] Navigating Sender to Offline Transcriber section...")
        tab_btn = driver_sender.find_element(By.ID, "tab-transcriber")
        tab_btn.click()
        time.sleep(1) # wait for tab transition
        
        print("-> Initializing Whisper Engine (Tiny)...")
        init_btn = driver_sender.find_element(By.ID, "init-engine-btn")
        init_btn.click()
        
        print("-> Waiting for model load. (This can take up to 90s on first load from CDN)...")
        # Wait up to 120s for model cache/download
        WebDriverWait(driver_sender, 120).until(
            EC.text_to_be_present_in_element((By.ID, "engine-status-badge"), "Active")
        )
        print("-> SUCCESS: Whisper AI engine loaded and active locally!")

        # Automated Mic test
        print("\n[Step 7] Testing voice recording trigger...")
        record_btn = driver_sender.find_element(By.ID, "record-audio-btn")
        record_btn.click()
        print("-> Recording started (Simulated microphone)...")
        time.sleep(3)
        record_btn.click()
        print("-> Recording stopped. WAVE stream processing...")
        
        # Upload mock WAV file test
        print(f"\n[Step 8] Uploading silent WAV file ({test_audio})...")
        audio_input = driver_sender.find_element(By.ID, "audio-file-input")
        audio_input.send_keys(test_audio)
        
        print("-> Waveform resampling and Whisper inference processing...")
        # Wait for transcribe loader to finish and output text
        WebDriverWait(driver_sender, 45).until(
            EC.visibility_of_element_located((By.ID, "transcription-result-card"))
        )
        text_output = driver_sender.find_element(By.ID, "transcript-text").text
        print(f"-> SUCCESS: Transcription finished! Raw Text Output: '{text_output.strip()}'")

        # DevTools Log checks
        print("\n[Step 9] Inspecting Browser Console Log Warnings/Errors...")
        sender_logs = driver_sender.get_log("browser")
        receiver_logs = driver_receiver.get_log("browser")
        
        critical_errors = []
        for log in sender_logs + receiver_logs:
            if log.get("level") == "SEVERE":
                critical_errors.append(log)
                print(f"-> [ERROR] {log.get('message')}")
        
        if not critical_errors:
            print("-> SUCCESS: Zero console errors found in DevTools!")
        else:
            print(f"-> WARNING: Found {len(critical_errors)} console errors.")

        print("\n====================================================")
        print("      ALL TESTS PASSED SUCCESSFULLY! (PASSED)       ")
        print("====================================================")

    except Exception as e:
        print("\n====================================================")
        print(f"                 TEST SUITE FAILED                  ")
        print(f"Reason: {e}")
        print("====================================================")
        # Output page info and console logs for debugging
        if driver_sender:
            print("\n--- SENDER PAGE INFO ---")
            try:
                print(f"URL: {driver_sender.current_url}")
                print(f"Title: {driver_sender.title}")
                print(f"Source Snippet: {driver_sender.page_source[:400]}")
            except Exception as info_err:
                print(f"Could not retrieve Sender info: {info_err}")
                
            print("\n--- SENDER CONSOLE LOGS ---")
            try:
                for entry in driver_sender.get_log("browser"):
                    print(entry)
            except Exception as log_err:
                print(f"Could not retrieve Sender logs: {log_err}")
                
        if driver_receiver:
            print("\n--- RECEIVER PAGE INFO ---")
            try:
                print(f"URL: {driver_receiver.current_url}")
                print(f"Title: {driver_receiver.title}")
                print(f"Source Snippet: {driver_receiver.page_source[:400]}")
            except Exception as info_err:
                print(f"Could not retrieve Receiver info: {info_err}")
                
            print("\n--- RECEIVER CONSOLE LOGS ---")
            try:
                for entry in driver_receiver.get_log("browser"):
                    print(entry)
            except Exception as log_err:
                print(f"Could not retrieve Receiver logs: {log_err}")
        sys.exit(1)

    finally:
        # Cleanup
        if driver_sender:
            driver_sender.quit()
        if driver_receiver:
            driver_receiver.quit()
        
        if os.path.exists(test_file):
            os.remove(test_file)
        if os.path.exists(test_audio):
            os.remove(test_audio)
        print("\nCleaned up browser and test files.")

if __name__ == "__main__":
    run_tests()
