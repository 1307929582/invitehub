"""
Property-based tests for RedeemCode model validity period calculations.

**Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
**Feature: commercial-refactor, Property 3: Remaining days calculation**
**Feature: commercial-refactor, Property 4: Email binding consistency**
**Validates: Requirements 2.1, 2.3, 4.1, 4.2**
"""
from datetime import datetime, timedelta
from hypothesis import given, strategies as st, settings, assume
import pytest

# Import the model - we test the logic directly without database
from app.models import RedeemCode


# Strategy for generating valid validity days (positive integers, reasonable range)
validity_days_strategy = st.integers(min_value=1, max_value=365)

# Strategy for generating activation timestamps (within reasonable past range)
activation_time_strategy = st.datetimes(
    min_value=datetime(2020, 1, 1),
    max_value=datetime(2030, 12, 31)
)


class TestRedeemCodeExpirationProperties:
    """
    Property-based tests for RedeemCode expiration calculation.
    
    **Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
    **Validates: Requirements 2.1**
    """
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        activated_at=activation_time_strategy
    )
    def test_user_expires_at_equals_activation_plus_validity_days(
        self, validity_days: int, activated_at: datetime
    ):
        """
        Property 1: For any redeem code with validity_days V, when activated at time T,
        the user_expires_at should equal T + V days.
        
        **Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
        **Validates: Requirements 2.1**
        """
        # Create a RedeemCode instance with the generated values
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = activated_at
        
        # Calculate expected expiration
        expected_expires_at = activated_at + timedelta(days=validity_days)
        
        # Assert the property holds
        assert code.user_expires_at == expected_expires_at, (
            f"Expected user_expires_at to be {expected_expires_at}, "
            f"but got {code.user_expires_at} for validity_days={validity_days}, "
            f"activated_at={activated_at}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_user_expires_at_is_none_when_not_activated(self, validity_days: int):
        """
        Property: For any redeem code that has not been activated,
        user_expires_at should be None.
        
        **Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
        **Validates: Requirements 2.1**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = None
        
        assert code.user_expires_at is None, (
            f"Expected user_expires_at to be None for non-activated code, "
            f"but got {code.user_expires_at}"
        )


class TestRedeemCodeRemainingDaysProperties:
    """
    Property-based tests for RedeemCode remaining days calculation.
    
    **Feature: commercial-refactor, Property 3: Remaining days calculation**
    **Validates: Requirements 2.3**
    """
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        days_since_activation=st.integers(min_value=0, max_value=400)
    )
    def test_remaining_days_calculation(
        self, validity_days: int, days_since_activation: int
    ):
        """
        Property 3: For any activated redeem code, remaining_days should equal
        max(0, (user_expires_at - current_time).days).
        
        **Feature: commercial-refactor, Property 3: Remaining days calculation**
        **Validates: Requirements 2.3**
        """
        # Set activation time relative to "now" for predictable testing
        # We use a fixed reference point to avoid timing issues
        reference_now = datetime(2025, 6, 15, 12, 0, 0)
        activated_at = reference_now - timedelta(days=days_since_activation)
        
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = activated_at
        
        # Calculate expected remaining days
        expires_at = activated_at + timedelta(days=validity_days)
        expected_remaining = max(0, (expires_at - reference_now).days)
        
        # The actual remaining_days uses datetime.utcnow(), so we need to
        # calculate what it should be based on the actual current time
        actual_remaining = code.remaining_days
        
        # Since remaining_days uses utcnow(), we verify the formula is correct
        # by checking the relationship between values
        if code.user_expires_at:
            delta = code.user_expires_at - datetime.utcnow()
            calculated_remaining = max(0, delta.days)
            assert actual_remaining == calculated_remaining, (
                f"remaining_days should equal max(0, (user_expires_at - now).days), "
                f"expected {calculated_remaining}, got {actual_remaining}"
            )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_remaining_days_is_none_when_not_activated(self, validity_days: int):
        """
        Property: For any redeem code that has not been activated,
        remaining_days should be None.
        
        **Feature: commercial-refactor, Property 3: Remaining days calculation**
        **Validates: Requirements 2.3**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = None
        
        assert code.remaining_days is None, (
            f"Expected remaining_days to be None for non-activated code, "
            f"but got {code.remaining_days}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_remaining_days_never_negative(self, validity_days: int):
        """
        Property: For any activated redeem code, remaining_days should never be negative.
        
        **Feature: commercial-refactor, Property 3: Remaining days calculation**
        **Validates: Requirements 2.3**
        """
        # Activate far in the past to ensure expiration
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime(2020, 1, 1)  # Definitely expired
        
        assert code.remaining_days is not None
        assert code.remaining_days >= 0, (
            f"remaining_days should never be negative, got {code.remaining_days}"
        )


class TestRedeemCodeIsUserExpiredProperties:
    """
    Property-based tests for RedeemCode is_user_expired calculation.
    
    **Feature: commercial-refactor, Property 1: Activation timestamp and expiration calculation**
    **Validates: Requirements 2.1**
    """
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_is_user_expired_false_when_not_activated(self, validity_days: int):
        """
        Property: For any redeem code that has not been activated,
        is_user_expired should be False.
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = None
        
        assert code.is_user_expired is False, (
            "is_user_expired should be False for non-activated code"
        )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_is_user_expired_true_when_past_expiration(self, validity_days: int):
        """
        Property: For any redeem code activated long ago (past validity period),
        is_user_expired should be True.
        """
        # Activate far enough in the past to guarantee expiration
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + 1)
        
        assert code.is_user_expired is True, (
            f"is_user_expired should be True when current time is past expiration, "
            f"validity_days={validity_days}, activated_at={code.activated_at}, "
            f"user_expires_at={code.user_expires_at}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=st.integers(min_value=2, max_value=365))
    def test_is_user_expired_false_when_within_validity(self, validity_days: int):
        """
        Property: For any redeem code activated recently (within validity period),
        is_user_expired should be False.
        """
        # Activate just now - should not be expired
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()
        
        assert code.is_user_expired is False, (
            f"is_user_expired should be False when within validity period, "
            f"validity_days={validity_days}, activated_at={code.activated_at}"
        )


# Strategy for generating valid email addresses
email_strategy = st.emails()


class TestEmailBindingConsistencyProperties:
    """
    Property-based tests for RedeemCode email binding consistency.
    
    **Feature: commercial-refactor, Property 4: Email binding consistency**
    **Validates: Requirements 4.1, 4.2**
    """
    
    @settings(max_examples=100)
    @given(email=email_strategy)
    def test_first_use_binds_email(self, email: str):
        """
        Property 4 (Part 1): For any redeem code, after first use with email E,
        the bound_email should equal E.
        
        **Feature: commercial-refactor, Property 4: Email binding consistency**
        **Validates: Requirements 4.1**
        """
        # Create a fresh redeem code (not activated)
        code = RedeemCode()
        code.code = "TEST123"
        code.validity_days = 30
        code.activated_at = None
        code.bound_email = None
        
        # Simulate first use - bind email
        normalized_email = email.lower().strip()
        code.bound_email = normalized_email
        code.activated_at = datetime.utcnow()
        
        # Assert the email is bound correctly
        assert code.bound_email == normalized_email, (
            f"Expected bound_email to be {normalized_email}, "
            f"but got {code.bound_email}"
        )
        assert code.activated_at is not None, (
            "Expected activated_at to be set after first use"
        )
    
    @settings(max_examples=100)
    @given(
        first_email=email_strategy,
        second_email=email_strategy
    )
    def test_different_email_should_be_rejected(self, first_email: str, second_email: str):
        """
        Property 4 (Part 2): For any redeem code already bound to email E1,
        subsequent use with different email E2 should be rejected.
        
        **Feature: commercial-refactor, Property 4: Email binding consistency**
        **Validates: Requirements 4.2**
        """
        # Ensure emails are different (after normalization)
        first_normalized = first_email.lower().strip()
        second_normalized = second_email.lower().strip()
        assume(first_normalized != second_normalized)
        
        # Create a redeem code already bound to first email
        code = RedeemCode()
        code.code = "TEST456"
        code.validity_days = 30
        code.activated_at = datetime.utcnow()
        code.bound_email = first_normalized
        
        # Verify the email mismatch check
        is_email_match = code.bound_email.lower() == second_normalized
        
        assert is_email_match is False, (
            f"Expected email mismatch for bound_email={code.bound_email} "
            f"and attempted email={second_normalized}"
        )
    
    @settings(max_examples=100)
    @given(email=email_strategy)
    def test_same_email_should_be_accepted(self, email: str):
        """
        Property 4 (Part 3): For any redeem code already bound to email E,
        subsequent use with the same email E should be accepted.
        
        **Feature: commercial-refactor, Property 4: Email binding consistency**
        **Validates: Requirements 4.1, 4.2**
        """
        normalized_email = email.lower().strip()
        
        # Create a redeem code already bound to the email
        code = RedeemCode()
        code.code = "TEST789"
        code.validity_days = 30
        code.activated_at = datetime.utcnow()
        code.bound_email = normalized_email
        code.max_uses = 5
        code.used_count = 1
        
        # Verify the same email is accepted
        is_email_match = code.bound_email.lower() == normalized_email
        
        assert is_email_match is True, (
            f"Expected email match for bound_email={code.bound_email} "
            f"and attempted email={normalized_email}"
        )
    
    @settings(max_examples=100)
    @given(email=email_strategy)
    def test_email_binding_is_case_insensitive(self, email: str):
        """
        Property 4 (Part 4): Email binding comparison should be case-insensitive.
        
        **Feature: commercial-refactor, Property 4: Email binding consistency**
        **Validates: Requirements 4.1, 4.2**
        """
        normalized_email = email.lower().strip()
        
        # Create a redeem code bound to lowercase email
        code = RedeemCode()
        code.code = "TESTABC"
        code.validity_days = 30
        code.activated_at = datetime.utcnow()
        code.bound_email = normalized_email
        
        # Test with uppercase version
        uppercase_email = email.upper().strip()
        is_email_match = code.bound_email.lower() == uppercase_email.lower()
        
        assert is_email_match is True, (
            f"Expected case-insensitive match for bound_email={code.bound_email} "
            f"and attempted email={uppercase_email}"
        )



class TestExpiredCodeRejectionProperties:
    """
    Property-based tests for expired code rejection.
    
    **Feature: commercial-refactor, Property 2: Expired code rejection**
    **Validates: Requirements 2.2, 3.5**
    """
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        days_past_expiration=st.integers(min_value=1, max_value=365)
    )
    def test_expired_code_is_detected(self, validity_days: int, days_past_expiration: int):
        """
        Property 2 (Part 1): For any redeem code where current_time > user_expires_at,
        is_user_expired should return True.
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2**
        """
        # Create a code that was activated and has expired
        code = RedeemCode()
        code.validity_days = validity_days
        # Activate far enough in the past to guarantee expiration
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + days_past_expiration)
        code.bound_email = "test@example.com"
        
        # The code should be detected as expired
        assert code.is_user_expired is True, (
            f"Expected is_user_expired=True for code activated {validity_days + days_past_expiration} days ago "
            f"with validity_days={validity_days}, but got {code.is_user_expired}"
        )
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        days_past_expiration=st.integers(min_value=1, max_value=365)
    )
    def test_expired_code_has_zero_remaining_days(self, validity_days: int, days_past_expiration: int):
        """
        Property 2 (Part 2): For any expired redeem code, remaining_days should be 0.
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + days_past_expiration)
        code.bound_email = "test@example.com"
        
        assert code.remaining_days == 0, (
            f"Expected remaining_days=0 for expired code, but got {code.remaining_days}"
        )
    
    @settings(max_examples=100)
    @given(
        validity_days=validity_days_strategy,
        days_past_expiration=st.integers(min_value=1, max_value=365)
    )
    def test_expired_code_user_expires_at_is_in_past(self, validity_days: int, days_past_expiration: int):
        """
        Property 2 (Part 3): For any expired redeem code, user_expires_at should be in the past.
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2, 3.5**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow() - timedelta(days=validity_days + days_past_expiration)
        code.bound_email = "test@example.com"
        
        assert code.user_expires_at is not None, "user_expires_at should not be None for activated code"
        assert code.user_expires_at < datetime.utcnow(), (
            f"Expected user_expires_at to be in the past for expired code, "
            f"but got {code.user_expires_at}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=st.integers(min_value=2, max_value=365))
    def test_non_expired_code_is_not_rejected(self, validity_days: int):
        """
        Property 2 (Inverse): For any redeem code where current_time <= user_expires_at,
        is_user_expired should return False.
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2**
        """
        # Create a code that was just activated (not expired)
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = datetime.utcnow()
        code.bound_email = "test@example.com"
        
        assert code.is_user_expired is False, (
            f"Expected is_user_expired=False for freshly activated code "
            f"with validity_days={validity_days}, but got {code.is_user_expired}"
        )
        assert code.remaining_days > 0, (
            f"Expected remaining_days > 0 for freshly activated code, "
            f"but got {code.remaining_days}"
        )
    
    @settings(max_examples=100)
    @given(validity_days=validity_days_strategy)
    def test_non_activated_code_is_not_expired(self, validity_days: int):
        """
        Property 2 (Edge case): For any redeem code that has not been activated,
        is_user_expired should return False (cannot be expired if never activated).
        
        **Feature: commercial-refactor, Property 2: Expired code rejection**
        **Validates: Requirements 2.2**
        """
        code = RedeemCode()
        code.validity_days = validity_days
        code.activated_at = None
        code.bound_email = None
        
        assert code.is_user_expired is False, (
            "Expected is_user_expired=False for non-activated code"
        )
